#[test_only]
module giam_siap::procurement_tests;

use giam_siap::procurement::{Self, ProcurementOrder, AgentCap, AdminCap, VendorRegistry};
use std::string;
use sui::clock::{Self, Clock};
use sui::coin;
use sui::sui::SUI;
use sui::test_scenario as ts;

const ADMIN: address = @0xAD;
const OWNER: address = @0xA;
const SUPPLIER: address = @0xB;

const RATE_MIST_PER_CENT: u64 = 100_000; // fixed demo-day rate used across all tests
const TARGET_PRICE_CENTS: u64 = 1000; // RM10.00/kg
const QUANTITY: u64 = 50; // kg

fun escrow_required(): u64 { QUANTITY * TARGET_PRICE_CENTS * RATE_MIST_PER_CENT }

fun setup(scenario: &mut ts::Scenario) {
    procurement::init_for_testing(ts::ctx(scenario));
    ts::next_tx(scenario, ADMIN);
    let admin_cap = ts::take_from_sender<AdminCap>(scenario);
    let mut registry = ts::take_shared<VendorRegistry>(scenario);
    procurement::update_rate(&admin_cap, &mut registry, RATE_MIST_PER_CENT);
    ts::return_shared(registry);
    ts::return_to_sender(scenario, admin_cap);
}

fun create_locked_order(scenario: &mut ts::Scenario, clock: &Clock): ID {
    ts::next_tx(scenario, OWNER);
    let registry = ts::take_shared<VendorRegistry>(scenario);
    let payment = coin::mint_for_testing<SUI>(escrow_required(), ts::ctx(scenario));
    let order_id = procurement::create_order(
        payment,
        &registry,
        string::utf8(b"coffee"),
        vector[string::utf8(b"https://example.com/price")],
        TARGET_PRICE_CENTS,
        QUANTITY,
        clock,
        ts::ctx(scenario),
    );
    ts::return_shared(registry);
    order_id
}

#[test]
fun test_create_order_happy_path() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));

    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    let order = ts::take_shared<ProcurementOrder>(&scenario);
    assert!(procurement::status(&order) == procurement::status_locked(), 0);
    assert!(procurement::owner(&order) == OWNER, 1);
    assert!(procurement::target_price(&order) == TARGET_PRICE_CENTS, 2);
    assert!(procurement::quantity(&order) == QUANTITY, 3);
    assert!(procurement::escrow_value(&order) == escrow_required(), 4);
    ts::return_shared(order);

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure]
fun test_create_order_rejects_zero_target_price() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, OWNER);
    let registry = ts::take_shared<VendorRegistry>(&scenario);
    let payment = coin::mint_for_testing<SUI>(escrow_required(), ts::ctx(&mut scenario));
    let _id = procurement::create_order(
        payment, &registry, string::utf8(b"coffee"), vector[], 0, QUANTITY, &clock, ts::ctx(&mut scenario),
    );
    abort 0
}

#[test, expected_failure]
fun test_create_order_rejects_zero_quantity() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, OWNER);
    let registry = ts::take_shared<VendorRegistry>(&scenario);
    let payment = coin::mint_for_testing<SUI>(escrow_required(), ts::ctx(&mut scenario));
    let _id = procurement::create_order(
        payment, &registry, string::utf8(b"coffee"), vector[], TARGET_PRICE_CENTS, 0, &clock, ts::ctx(&mut scenario),
    );
    abort 0
}

#[test, expected_failure]
fun test_create_order_rejects_insufficient_escrow() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, OWNER);
    let registry = ts::take_shared<VendorRegistry>(&scenario);
    let payment = coin::mint_for_testing<SUI>(escrow_required() - 1, ts::ctx(&mut scenario));
    let _id = procurement::create_order(
        payment, &registry, string::utf8(b"coffee"), vector[], TARGET_PRICE_CENTS, QUANTITY, &clock, ts::ctx(&mut scenario),
    );
    abort 0
}

#[test, expected_failure]
fun test_create_order_rejects_unconfigured_registry() {
    let mut scenario = ts::begin(ADMIN);
    procurement::init_for_testing(ts::ctx(&mut scenario)); // rate left at 0, never configured
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));

    ts::next_tx(&mut scenario, OWNER);
    let registry = ts::take_shared<VendorRegistry>(&scenario);
    let payment = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
    let _id = procurement::create_order(
        payment, &registry, string::utf8(b"coffee"), vector[], TARGET_PRICE_CENTS, QUANTITY, &clock, ts::ctx(&mut scenario),
    );
    abort 0
}

#[test]
fun test_cancel_order_happy_path() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    let mut order = ts::take_shared<ProcurementOrder>(&scenario);
    procurement::cancel_order(&mut order, ts::ctx(&mut scenario));
    assert!(procurement::status(&order) == procurement::status_cancelled(), 0);
    assert!(procurement::escrow_value(&order) == 0, 1);
    ts::return_shared(order);

    ts::next_tx(&mut scenario, OWNER);
    let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
    assert!(coin::value(&refund) == escrow_required(), 2);
    ts::return_to_sender(&scenario, refund);

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure]
fun test_cancel_order_rejects_non_owner() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, SUPPLIER); // not the owner
    let mut order = ts::take_shared<ProcurementOrder>(&scenario);
    procurement::cancel_order(&mut order, ts::ctx(&mut scenario));
    abort 0
}

#[test, expected_failure]
fun test_cancel_order_rejects_non_locked_status() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, OWNER);
    let mut order = ts::take_shared<ProcurementOrder>(&scenario);
    procurement::cancel_order(&mut order, ts::ctx(&mut scenario));
    // already Cancelled now — a second cancel must revert
    procurement::cancel_order(&mut order, ts::ctx(&mut scenario));
    abort 0
}

#[test]
fun test_admin_can_rotate_vendor_pubkey() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);

    ts::next_tx(&mut scenario, ADMIN);
    let admin_cap = ts::take_from_sender<AdminCap>(&scenario);
    let mut registry = ts::take_shared<VendorRegistry>(&scenario);
    let new_key = vector[1u8, 2u8, 3u8];
    procurement::update_vendor_pubkey(&admin_cap, &mut registry, new_key);
    assert!(procurement::trusted_pubkey(&registry) == vector[1u8, 2u8, 3u8], 0);
    ts::return_shared(registry);
    ts::return_to_sender(&scenario, admin_cap);

    ts::end(scenario);
}

// --- execute_order: signature-independent revert branches ---

#[test, expected_failure]
fun test_execute_order_rejects_missing_signature_registration() {
    // registry.trusted_pubkey is still empty (never rotated from init's placeholder) — any
    // signature must fail verification against an empty key.
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let clock = clock::create_for_testing(ts::ctx(&mut scenario));
    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, ADMIN);
    let agent_cap = ts::take_from_sender<AgentCap>(&scenario);
    let registry = ts::take_shared<VendorRegistry>(&scenario);
    let mut order = ts::take_shared<ProcurementOrder>(&scenario);
    procurement::execute_order(
        &mut order, &agent_cap, &registry, TARGET_PRICE_CENTS, SUPPLIER, 0, vector[0u8], &clock, ts::ctx(&mut scenario),
    );
    abort 0
}

// --- execute_order: real ed25519 fixtures ---
// Generated offline (scratchpad/gen_test_sig.js, Node's crypto ed25519) for the exact message
// format build_message() produces: "item|price_cents|ts|supplier_address" where
// supplier_address is sui::address::to_string(@0xB) = 64 lowercase hex chars, no "0x" prefix.

// price=950 (<= target 1000), ts=1000
const HAPPY_PUBKEY: vector<u8> = vector[113u8, 164u8, 76u8, 122u8, 32u8, 59u8, 26u8, 42u8, 166u8, 135u8, 130u8, 210u8, 208u8, 142u8, 143u8, 0u8, 161u8, 91u8, 237u8, 213u8, 252u8, 210u8, 216u8, 173u8, 247u8, 181u8, 134u8, 169u8, 232u8, 8u8, 99u8, 252u8];
const HAPPY_SIG: vector<u8> = vector[139u8, 156u8, 202u8, 154u8, 120u8, 234u8, 204u8, 108u8, 184u8, 70u8, 214u8, 41u8, 245u8, 219u8, 198u8, 10u8, 29u8, 119u8, 185u8, 131u8, 133u8, 29u8, 235u8, 4u8, 163u8, 153u8, 245u8, 80u8, 37u8, 219u8, 243u8, 32u8, 204u8, 112u8, 137u8, 252u8, 212u8, 28u8, 250u8, 90u8, 11u8, 56u8, 218u8, 197u8, 192u8, 247u8, 127u8, 206u8, 223u8, 225u8, 66u8, 21u8, 65u8, 115u8, 103u8, 171u8, 32u8, 163u8, 71u8, 227u8, 204u8, 77u8, 239u8, 15u8];
const HAPPY_PRICE: u64 = 950;
const HAPPY_TS: u64 = 1000;

// price=1500 (> target 1000), ts=1000 — validly signed, price still too high
const HIGH_PUBKEY: vector<u8> = vector[4u8, 59u8, 38u8, 71u8, 36u8, 226u8, 170u8, 124u8, 118u8, 56u8, 45u8, 186u8, 148u8, 25u8, 172u8, 34u8, 196u8, 24u8, 249u8, 236u8, 125u8, 108u8, 61u8, 17u8, 161u8, 59u8, 71u8, 64u8, 111u8, 147u8, 171u8, 186u8];
const HIGH_SIG: vector<u8> = vector[29u8, 173u8, 225u8, 232u8, 230u8, 197u8, 131u8, 161u8, 185u8, 191u8, 219u8, 126u8, 221u8, 63u8, 2u8, 143u8, 9u8, 79u8, 160u8, 71u8, 249u8, 143u8, 164u8, 45u8, 57u8, 219u8, 129u8, 195u8, 124u8, 17u8, 178u8, 116u8, 152u8, 139u8, 191u8, 195u8, 172u8, 150u8, 190u8, 231u8, 90u8, 163u8, 19u8, 193u8, 55u8, 37u8, 137u8, 220u8, 153u8, 108u8, 89u8, 8u8, 41u8, 34u8, 14u8, 68u8, 119u8, 55u8, 75u8, 57u8, 111u8, 56u8, 174u8, 0u8];
const HIGH_PRICE: u64 = 1500;

// price=950, ts=1 — validly signed, timestamp far in the past
const STALE_PUBKEY: vector<u8> = vector[114u8, 226u8, 137u8, 203u8, 36u8, 50u8, 200u8, 170u8, 192u8, 180u8, 208u8, 25u8, 69u8, 86u8, 136u8, 214u8, 44u8, 218u8, 95u8, 45u8, 124u8, 234u8, 238u8, 29u8, 20u8, 227u8, 213u8, 215u8, 167u8, 190u8, 195u8, 176u8];
const STALE_SIG: vector<u8> = vector[133u8, 84u8, 45u8, 205u8, 38u8, 15u8, 35u8, 89u8, 148u8, 112u8, 185u8, 31u8, 18u8, 254u8, 124u8, 11u8, 21u8, 107u8, 48u8, 15u8, 147u8, 213u8, 234u8, 168u8, 34u8, 245u8, 146u8, 204u8, 128u8, 48u8, 226u8, 156u8, 13u8, 143u8, 125u8, 16u8, 141u8, 55u8, 116u8, 26u8, 29u8, 239u8, 221u8, 206u8, 129u8, 140u8, 150u8, 245u8, 169u8, 214u8, 177u8, 236u8, 169u8, 205u8, 132u8, 20u8, 178u8, 130u8, 174u8, 68u8, 178u8, 215u8, 32u8, 0u8];
const STALE_TS: u64 = 1;

#[test]
fun test_execute_order_happy_path() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut clock, HAPPY_TS * 1000);
    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, ADMIN);
    let admin_cap = ts::take_from_sender<AdminCap>(&scenario);
    let agent_cap = ts::take_from_sender<AgentCap>(&scenario);
    let mut registry = ts::take_shared<VendorRegistry>(&scenario);
    procurement::update_vendor_pubkey(&admin_cap, &mut registry, HAPPY_PUBKEY);
    let mut order = ts::take_shared<ProcurementOrder>(&scenario);

    procurement::execute_order(
        &mut order, &agent_cap, &registry, HAPPY_PRICE, SUPPLIER, HAPPY_TS, HAPPY_SIG, &clock, ts::ctx(&mut scenario),
    );

    assert!(procurement::status(&order) == procurement::status_fulfilled(), 0);
    assert!(procurement::supplier(&order) == option::some(SUPPLIER), 1);
    let expected_payout = QUANTITY * HAPPY_PRICE * RATE_MIST_PER_CENT;
    assert!(procurement::escrow_value(&order) == 0, 2);

    ts::return_shared(order);
    ts::return_shared(registry);
    ts::return_to_sender(&scenario, agent_cap);
    ts::return_to_sender(&scenario, admin_cap);

    ts::next_tx(&mut scenario, SUPPLIER);
    let payout = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
    assert!(coin::value(&payout) == expected_payout, 3);
    ts::return_to_sender(&scenario, payout);

    ts::next_tx(&mut scenario, OWNER);
    let refund = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
    assert!(coin::value(&refund) == escrow_required() - expected_payout, 4);
    ts::return_to_sender(&scenario, refund);

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure]
fun test_execute_order_rejects_invalid_signature() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut clock, HAPPY_TS * 1000);
    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, ADMIN);
    let admin_cap = ts::take_from_sender<AdminCap>(&scenario);
    let agent_cap = ts::take_from_sender<AgentCap>(&scenario);
    let mut registry = ts::take_shared<VendorRegistry>(&scenario);
    procurement::update_vendor_pubkey(&admin_cap, &mut registry, HAPPY_PUBKEY);
    let mut order = ts::take_shared<ProcurementOrder>(&scenario);

    // HAPPY_SIG was computed over price=950 — claiming price=900 with the same signature must fail.
    procurement::execute_order(
        &mut order, &agent_cap, &registry, 900, SUPPLIER, HAPPY_TS, HAPPY_SIG, &clock, ts::ctx(&mut scenario),
    );
    abort 0
}

#[test, expected_failure]
fun test_execute_order_rejects_stale_timestamp() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut clock, STALE_TS * 1000);
    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, ADMIN);
    let admin_cap = ts::take_from_sender<AdminCap>(&scenario);
    let agent_cap = ts::take_from_sender<AgentCap>(&scenario);
    let mut registry = ts::take_shared<VendorRegistry>(&scenario);
    procurement::update_vendor_pubkey(&admin_cap, &mut registry, STALE_PUBKEY);
    let mut order = ts::take_shared<ProcurementOrder>(&scenario);

    // Advance the clock well past MAX_STALENESS_SECONDS from STALE_TS before executing.
    clock::set_for_testing(&mut clock, (STALE_TS + 1_000_000) * 1000);
    procurement::execute_order(
        &mut order, &agent_cap, &registry, HAPPY_PRICE, SUPPLIER, STALE_TS, STALE_SIG, &clock, ts::ctx(&mut scenario),
    );
    abort 0
}

#[test, expected_failure]
fun test_execute_order_rejects_price_above_target() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut clock, HAPPY_TS * 1000);
    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, ADMIN);
    let admin_cap = ts::take_from_sender<AdminCap>(&scenario);
    let agent_cap = ts::take_from_sender<AgentCap>(&scenario);
    let mut registry = ts::take_shared<VendorRegistry>(&scenario);
    procurement::update_vendor_pubkey(&admin_cap, &mut registry, HIGH_PUBKEY);
    let mut order = ts::take_shared<ProcurementOrder>(&scenario);

    procurement::execute_order(
        &mut order, &agent_cap, &registry, HIGH_PRICE, SUPPLIER, HAPPY_TS, HIGH_SIG, &clock, ts::ctx(&mut scenario),
    );
    abort 0
}

#[test, expected_failure]
fun test_execute_order_rejects_already_fulfilled() {
    let mut scenario = ts::begin(ADMIN);
    setup(&mut scenario);
    let mut clock = clock::create_for_testing(ts::ctx(&mut scenario));
    clock::set_for_testing(&mut clock, HAPPY_TS * 1000);
    create_locked_order(&mut scenario, &clock);

    ts::next_tx(&mut scenario, ADMIN);
    let admin_cap = ts::take_from_sender<AdminCap>(&scenario);
    let agent_cap = ts::take_from_sender<AgentCap>(&scenario);
    let mut registry = ts::take_shared<VendorRegistry>(&scenario);
    procurement::update_vendor_pubkey(&admin_cap, &mut registry, HAPPY_PUBKEY);
    let mut order = ts::take_shared<ProcurementOrder>(&scenario);

    procurement::execute_order(
        &mut order, &agent_cap, &registry, HAPPY_PRICE, SUPPLIER, HAPPY_TS, HAPPY_SIG, &clock, ts::ctx(&mut scenario),
    );
    // order is now Fulfilled — a second execute_order (e.g. a replayed quote) must revert.
    procurement::execute_order(
        &mut order, &agent_cap, &registry, HAPPY_PRICE, SUPPLIER, HAPPY_TS, HAPPY_SIG, &clock, ts::ctx(&mut scenario),
    );
    abort 0
}
