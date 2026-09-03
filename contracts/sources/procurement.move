/// Escrow + settlement for Giam Siap. See IMPLEMENTATION_PLAN.md §3 for the full design rationale.
module giam_siap::procurement;

use std::string::{Self, String};
use sui::address;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::ed25519;
use sui::event;
use sui::sui::SUI;

const STATUS_LOCKED: u8 = 1;
const STATUS_FULFILLED: u8 = 2;
const STATUS_CANCELLED: u8 = 3;

/// A signed vendor price quote is only accepted within this window of its own timestamp.
const MAX_STALENESS_SECONDS: u64 = 300;

const PIPE: u8 = 124; // ASCII '|' — matches the vendor interface spec in IMPLEMENTATION_PLAN.md §4.2

const E_ZERO_TARGET_PRICE: u64 = 1;
const E_ZERO_QUANTITY: u64 = 2;
const E_INSUFFICIENT_ESCROW: u64 = 3;
const E_REGISTRY_NOT_CONFIGURED: u64 = 4;
const E_NOT_LOCKED: u64 = 5;
const E_INVALID_SIGNATURE: u64 = 6;
const E_STALE_TIMESTAMP: u64 = 7;
const E_PRICE_ABOVE_TARGET: u64 = 8;
const E_NOT_OWNER: u64 = 9;
const E_ZERO_RATE: u64 = 10;

public struct ProcurementOrder has key, store {
    id: UID,
    owner: address,
    item_id: String,
    vendor_urls: vector<String>,
    /// Price per unit, in USD cents — the same unit the vendor's signature covers (§4.2).
    target_price: u64,
    quantity: u64,
    escrow: Balance<SUI>,
    supplier: Option<address>,
    status: u8,
    created_at: u64,
}

/// Capability object — only the holder can call `execute_order`. Revocable: the owner can
/// burn or transfer it to kill agent authority without touching escrow logic.
public struct AgentCap has key, store {
    id: UID,
}

/// Registered once at publish, kept current by whoever holds `AdminCap`.
public struct VendorRegistry has key {
    id: UID,
    /// The mock vendor's ed25519 public key. Empty until an admin registers it via
    /// `update_vendor_pubkey` — `execute_order` cannot succeed against an empty key.
    trusted_pubkey: vector<u8>,
    /// Fixed demo-day USD-cents -> MIST rate. Lives on-chain so create_order's invariant and
    /// execute_order's payout always read the SAME rate (§3).
    rate_mist_per_cent: u64,
}

/// Lets you rotate `trusted_pubkey` / `rate_mist_per_cent` without redeploying the package.
public struct AdminCap has key, store {
    id: UID,
}

public struct OrderCreated has copy, drop {
    order_id: ID,
    owner: address,
    target_price: u64,
    quantity: u64,
}

public struct OrderFulfilled has copy, drop {
    order_id: ID,
    price: u64,
    supplier: address,
}

public struct OrderCancelled has copy, drop {
    order_id: ID,
}

fun init(ctx: &mut TxContext) {
    let admin_cap = AdminCap { id: object::new(ctx) };
    let agent_cap = AgentCap { id: object::new(ctx) };
    let registry = VendorRegistry {
        id: object::new(ctx),
        trusted_pubkey: vector[],
        rate_mist_per_cent: 0,
    };
    transfer::transfer(admin_cap, tx_context::sender(ctx));
    transfer::transfer(agent_cap, tx_context::sender(ctx));
    transfer::share_object(registry);
}

/// Locks `payment` into a new shared `ProcurementOrder`. Reverts if the escrowed amount doesn't
/// cover `quantity * target_price` at the registry's rate — this must fail here, never at
/// settlement time (the escrow-sufficiency invariant, §3).
public fun create_order(
    payment: Coin<SUI>,
    registry: &VendorRegistry,
    item_id: String,
    vendor_urls: vector<String>,
    target_price: u64,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    assert!(target_price > 0, E_ZERO_TARGET_PRICE);
    assert!(quantity > 0, E_ZERO_QUANTITY);
    assert!(registry.rate_mist_per_cent > 0, E_REGISTRY_NOT_CONFIGURED);

    let required = (quantity * target_price) * registry.rate_mist_per_cent;
    assert!(coin::value(&payment) >= required, E_INSUFFICIENT_ESCROW);

    let owner = tx_context::sender(ctx);
    let order = ProcurementOrder {
        id: object::new(ctx),
        owner,
        item_id,
        vendor_urls,
        target_price,
        quantity,
        escrow: coin::into_balance(payment),
        supplier: option::none(),
        status: STATUS_LOCKED,
        created_at: sui::clock::timestamp_ms(clock),
    };
    let order_id = object::id(&order);
    event::emit(OrderCreated { order_id, owner, target_price, quantity });
    transfer::share_object(order);
    order_id
}

/// Verifies the vendor's signed quote against `VendorRegistry.trusted_pubkey`, then — only if the
/// signature is valid, fresh, and the price meets the owner's target — splits payout to
/// `supplier` and refunds the remainder to the owner, atomically. Requires holding `AgentCap`.
public fun execute_order(
    order: &mut ProcurementOrder,
    _cap: &AgentCap,
    registry: &VendorRegistry,
    price: u64,
    supplier: address,
    ts: u64,
    sig: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(order.status == STATUS_LOCKED, E_NOT_LOCKED);

    let msg = build_message(order.item_id, price, ts, supplier);
    assert!(ed25519::ed25519_verify(&sig, &registry.trusted_pubkey, &msg), E_INVALID_SIGNATURE);

    let now_s = sui::clock::timestamp_ms(clock) / 1000;
    assert!(ts <= now_s, E_STALE_TIMESTAMP);
    assert!(now_s - ts <= MAX_STALENESS_SECONDS, E_STALE_TIMESTAMP);

    assert!(price <= order.target_price, E_PRICE_ABOVE_TARGET);

    let payout_mist = (order.quantity * price) * registry.rate_mist_per_cent;
    assert!(payout_mist <= balance::value(&order.escrow), E_INSUFFICIENT_ESCROW);

    let payout_balance = balance::split(&mut order.escrow, payout_mist);
    transfer::public_transfer(coin::from_balance(payout_balance, ctx), supplier);

    let remainder = balance::withdraw_all(&mut order.escrow);
    if (balance::value(&remainder) > 0) {
        transfer::public_transfer(coin::from_balance(remainder, ctx), order.owner);
    } else {
        balance::destroy_zero(remainder);
    };

    order.supplier = option::some(supplier);
    order.status = STATUS_FULFILLED;
    event::emit(OrderFulfilled { order_id: object::id(order), price, supplier });
}

/// Owner-only escape hatch: refunds the full escrow and cancels a still-`Locked` order.
public fun cancel_order(order: &mut ProcurementOrder, ctx: &mut TxContext) {
    assert!(tx_context::sender(ctx) == order.owner, E_NOT_OWNER);
    assert!(order.status == STATUS_LOCKED, E_NOT_LOCKED);

    let refund = balance::withdraw_all(&mut order.escrow);
    transfer::public_transfer(coin::from_balance(refund, ctx), order.owner);

    order.status = STATUS_CANCELLED;
    event::emit(OrderCancelled { order_id: object::id(order) });
}

public fun update_vendor_pubkey(_: &AdminCap, registry: &mut VendorRegistry, new_pubkey: vector<u8>) {
    registry.trusted_pubkey = new_pubkey;
}

public fun update_rate(_: &AdminCap, registry: &mut VendorRegistry, new_rate_mist_per_cent: u64) {
    assert!(new_rate_mist_per_cent > 0, E_ZERO_RATE);
    registry.rate_mist_per_cent = new_rate_mist_per_cent;
}

/// Builds `item|price_cents|ts|supplier_address` exactly as specified in the vendor interface
/// spec (§4.2), so any off-chain stack can produce byte-identical signed messages.
fun build_message(item_id: String, price: u64, ts: u64, supplier: address): vector<u8> {
    let mut msg = *string::as_bytes(&item_id);
    vector::push_back(&mut msg, PIPE);
    vector::append(&mut msg, *string::as_bytes(&u64_to_string(price)));
    vector::push_back(&mut msg, PIPE);
    vector::append(&mut msg, *string::as_bytes(&u64_to_string(ts)));
    vector::push_back(&mut msg, PIPE);
    vector::append(&mut msg, *string::as_bytes(&address::to_string(supplier)));
    msg
}

fun u64_to_string(value: u64): String {
    if (value == 0) {
        return string::utf8(b"0")
    };
    let mut digits = vector[];
    let mut v = value;
    while (v > 0) {
        let digit = ((v % 10) as u8) + 48;
        vector::push_back(&mut digits, digit);
        v = v / 10;
    };
    vector::reverse(&mut digits);
    string::utf8(digits)
}

public fun status(order: &ProcurementOrder): u8 { order.status }

public fun owner(order: &ProcurementOrder): address { order.owner }

public fun target_price(order: &ProcurementOrder): u64 { order.target_price }

public fun quantity(order: &ProcurementOrder): u64 { order.quantity }

public fun escrow_value(order: &ProcurementOrder): u64 { balance::value(&order.escrow) }

public fun supplier(order: &ProcurementOrder): Option<address> { order.supplier }

public fun trusted_pubkey(registry: &VendorRegistry): vector<u8> { registry.trusted_pubkey }

public fun rate_mist_per_cent(registry: &VendorRegistry): u64 { registry.rate_mist_per_cent }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

#[test_only]
public fun status_locked(): u8 { STATUS_LOCKED }

#[test_only]
public fun status_fulfilled(): u8 { STATUS_FULFILLED }

#[test_only]
public fun status_cancelled(): u8 { STATUS_CANCELLED }
