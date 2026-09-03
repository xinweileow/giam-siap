# [Idea T2: AI X SUI] AI Food Procurement + SUI

**Core Target of this track**: AI Agent acting on behalf of the user to trigger smart contract payments.

- transaction-executing assistants
- workflow automation
- agent-to-agent commerce

---

## 1. Idea Overview

**Giam Siap** is an **agentic B2B auto-buying engine** for SME restaurants and suppliers. Restaurant owners set inventory purchase requests and target budgets via Telegram chat. A Sui Move smart contract locks the funds in escrow, while a Hermes AI Agent continuously scans vendor web feeds, triggering instant on-chain settlement the moment market prices meet the buyer's target.

## 2. Problem Statement

- **SME Restaurant Owners:** Manual price tracking across multiple vendors wastes time. Volatile fresh ingredient prices mean owners overpay or face stockouts.
- **Food Suppliers:** Delayed payment terms (Net-30 or Net-60 day invoices) restrict cash flow and strain vendor operations.
- **Trust & Automation Deficit:** Web2 automation cannot safely delegate financial spending power to AI without manual approval steps or high third-party processing fees.

## 3. Solution, Features & WOW Factors

- **Solution:** A trustless escrow protocol combined with an autonomous AI monitoring agent on Sui.
- **Key Features:**
  - *Conversational Escrow:* Lock funds into smart contract escrow by messaging a Telegram bot.
  - *Autonomous Price Sentry:* AI agent periodically fetches price data from target supplier web pages.
  - *Atomic Settlement:* Instant release of funds to the supplier upon order execution.
- **WOW Factors:**
  - **Agentic Autonomous Commerce:** Demonstrates an AI agent holding scoped financial authority to complete real-world trades within strict user guardrails.
  - **Zero Web3 Friction:** Owners sign up via email/Google (**zkLogin**) and pay no gas fees (**Sponsored Transactions**).

## 4. Tech Division & User Stories

### Where SUI Steps In

- **Escrow & State:** Move smart contract (`ProcurementOrder` object) holds locked funds securely on-chain.
- **Programmable Transaction Blocks (PTBs):** Batches price validation, escrow release, and receipt generation into one atomic transaction.
- **Identity & UX:** zkLogin handles non-custodial user accounts; sponsored transactions eliminate native gas management.

### When AI Steps In

- **Intent Parsing:** Converts natural language Telegram messages ("Lock $500 for Arabica Coffee at $10/kg") into smart contract parameters.
- **Web Scraper Tool:** Periodically fetches structured price data from vendor URLs.
- **Execution Trigger:** Evaluates `vendor_price <= target_price` and signs the Sui Move contract invocation.

### User Stories

#### Restaurant Owner User Story (End-to-End Workflow)

- **Persona:** SME Cafe Owner / Procurement Manager
- **User Story:** "As a cafe manager, I want to initiate a procurement request directly in Telegram, lock budget funds into a Sui smart contract escrow, have an AI agent monitor vendor prices 24/7, and automatically settle the order when my price target is hit, so that I secure inventory at optimal rates without manual work."
- **End-to-End Workflow Steps:**
  1. **Input:** The owner sends a natural language command to the Telegram bot (e.g., *"Procure 50kg Coffee Beans with a max budget of $500 at target price $10/kg"*).
  2. **Contract Creation:** The Hermes AI Agent parses the request parameters and prompts the owner to authorize the Sui Move smart contract (`create_order`).
  3. **Escrow Lock:** The owner approves the transaction via zkLogin, locking 500 testnet USDC into the Move escrow object without managing gas fees.
  4. **Autonomous Monitoring:** The AI agent actively fetches vendor web price feeds in the background while updating the owner's status log in Telegram.
  5. **Outcome:** Once a vendor's price drops to $10/kg, the AI agent triggers the Sui Programmable Transaction Block (PTB) execution, settles the trade, and sends a final Suiscan receipt link to the owner's Telegram chat.

#### Supplier User Story (End-to-End Workflow)

- **Persona:** Wholesale Food Vendor / Distributor
- **User Story:** "As a food supplier, I want to update my daily product pricing on my portal and have ProcureSui AI automatically detect price matches against active buyer escrows, so that orders execute immediately and I receive instant on-chain token payouts without invoice delays."
- **End-to-End Workflow Steps:**
  1. **Input:** The supplier updates their web catalog or inventory dashboard price (e.g., running a flash sale that lowers coffee beans from $12.00/kg to $9.50/kg).
  2. **Web Scan & Match:** The ProcureSui AI agent fetches the updated web page, parses the price change, and matches $9.50/kg against active on-chain escrow orders.
  3. **Smart Contract Execution:** The AI agent invokes the Move smart contract's `execute_order` function using its scoped signing authority.
  4. **Outcome:** Escrowed funds disburse directly to the supplier's Sui wallet within seconds, the monitoring dashboard reflects the `FULFILLED` status, and the supplier gets an automated delivery dispatch alert.

## 5. 4-Day MVP Scope (Completion > Complexity)

Focus strictly on finishing the end-to-end loop rather than writing complex AI logic.

- **Sui Move Smart Contract:** Write two core functions: `create_order(item_id, target_price, amount)` to lock funds into a Move object and `execute_order(order_id, supplier_address)` to disburse escrow.
- **Hermes Agent (Backend):** Connect Hermes Agent to Telegram via BotFather, using custom tools to fetch prices from your mock endpoint and trigger Sui Programmable Transaction Blocks (PTBs).
- **Mock Vendor Website:** Host a simple 1-page site displaying an item price with a toggle or slider to manually trigger a price drop from $12.00 to $9.50.
- **Admin & Escrow Monitoring Dashboard:** Build a single-page Web UI that periodically queries the Sui RPC for `ProcurementOrder` objects to display live platform metrics.

### What the Monitoring Dashboard Should Display

To avoid overbuilding while keeping visual impact high, limit the dashboard to three key elements:

- **Escrow Vault Tracker:** Shows total testnet SUI/USDC currently locked in active contracts vs. total settled funds.
- **Live Order Table:** Displays active orders with key fields:
  - Order ID & Owner Wallet
  - Target Price vs. Current Scraped Price
  - Status Badge: LOCKED / MONITORING (Yellow) → EXECUTED (Green)
- **Transaction Log:** Automatically appends direct Suiscan Explorer links whenever the AI agent executes a trade block.

## 6. Demo Workability, Currency Choice & Strategy

### Payment Currency: Use Sui Testnet Tokens (or Testnet USDC)

Never use real fiat or mainnet funds on stage. Using Sui Testnet tokens or Testnet USDC proves complete technical execution, eliminates mainnet latency, avoids financial risk, and satisfies hackathon judging standards.

### 2-Minute Live Demo Strategy

1. **Step 1 (Owner Request):** Presenter texts the Telegram Bot live: *"Lock 500 SUI for 50kg Coffee Beans at target $10/kg"*. Show the resulting Suiscan escrow transaction link.
2. **Step 2 (Pending State):** Open the Mock Vendor Website tab showing coffee listed at **$12.00/kg**. The Telegram bot logs: *"Monitoring active. Vendor price exceeds target."*
3. **Step 3 (Price Drop):** Teammate clicks "Apply Flash Sale" on the mock vendor site, dropping the web listing to **$9.50/kg**.
4. **Step 4 (Autonomous Execution):** Prompt the Telegram bot (or run the scheduled check). Hermes fetches the mock site content, detects $9.50 ≤ $10.00, and calls the Sui Move smart contract.
5. **Step 5 (On-Chain Verification):** Telegram displays: *"🎉 Order Executed at $9.50/kg!"* Refresh Suiscan live to show the escrow balance transferred directly to the supplier's testnet wallet.

### The "Hybrid 3-URL" Demo Strategy

To make the live demo look 100% real on stage without risking a failure, have your agent scan three distinct links concurrently:

- **URL 1 (Real Live Wholesale/Shopee Link):** Price is $14.00/kg.
  - *Agent Log:* `Checking URL 1... Price: $14.00/kg. (Exceeds $10.00 budget. Skipping).`
- **URL 2 (Real Food Distributor Link):** Price is $12.50/kg.
  - *Agent Log:* `Checking URL 2... Price: $12.50/kg. (Exceeds $10.00 budget. Skipping).`
- **URL 3 (Your Controlled Live Web Page):** Price drops to $9.50/kg during demo.
  - *Agent Log:* `Checking URL 3... Price: $9.50/kg. TARGET MATCHED ($9.50 <= $10.00)! Executing Sui PTB...`

---

## 1. Native Sui Features & Primitives

- **zkLogin**
  - **What it is:** A Sui primitive that allows users to generate and manage non-custodial Sui addresses using familiar Web2 OAuth credentials (such as Google or Twitch).
  - **How to use it:** Restaurant owners and suppliers onboard using their existing Google accounts without creating Web3 wallets or managing seed phrases.
- **Programmable Transaction Blocks (PTBs)**
  - **What it is:** A transaction execution model that executes up to 1,024 commands atomically in a single block.
  - **How to use it:** When the AI agent triggers an order, a single PTB can sequentially check target price conditions, split funds from the escrow object, disburse stablecoins to the supplier, refund excess balance, and emit an audit receipt event. If any step fails, the entire block reverts atomically.
- **Sponsored Transactions (Gas Station)**
  - **What it is:** A feature allowing a third-party sponsor to pay transaction gas fees on behalf of the user.
  - **How to use it:** Cafe owners do not need to hold native SUI tokens to create or manage escrow orders. Your backend service acts as the gas sponsor, creating a completely gasless experience for non-crypto users.
- **Sui Object Model (Shared Objects)**
  - **What it is:** Sui's object-centric architecture allows digital assets and smart contracts to exist as explicit stateful objects.
  - **How to use it:** Define each `ProcurementOrder` as a **Shared Object** on-chain. This allows the restaurant owner to create and own the initial escrow state while permitting your authorized Hermes AI Agent to invoke fulfillment functions on that shared object.

## 2. Sui Ecosystem Toolkits & Infrastructure

- **Walrus (Decentralized Storage Protocol)**
  - **What it is:** A decentralized storage and data availability protocol built for large binary files or blobs, using Sui for coordination and payment.
  - **How to use it:** Store immutable invoice PDFs, historical supplier catalog snapshots, or AI agent verification logs on Walrus, linking the resulting Blob ID to the `ProcurementOrder` object on Sui.
- **Sui TypeScript SDK (`@mysten/sui`)**
  - **What it is:** The official TypeScript SDK for interacting with full nodes, executing PTBs, and querying Move objects.
  - **How to use it:** Use the SDK inside your Hermes Agent backend and Web Dashboard to construct PTBs, sign transactions, and listen for live smart contract events.
- **Sui GraphQL API / JSON-RPC**
  - **What it is:** Transport interfaces for querying on-chain events, object states, and transaction histories.
  - **How to use it:** Feed your real-time Monitoring Dashboard by subscribing to `OrderCreated` and `OrderFulfilled` events emitted by your Move smart contract.

---

### Wei Xin Self Use only:

## Hermes Agent Bot Deployment

Deploying the agent to the cloud ensures your background scraper and Sui PTB triggers remain active, preventing live demo issues like laptop Wi-Fi dropouts or closed terminal windows on stage.

### Fastest Deployment Options for a 4-Day Hackathon

- **Option 1: Railway / Render (PaaS — Fastest & Recommended)**
  - **Setup Time:** 5–10 minutes.
  - **How it works:** Railway and Render offer one-click Docker templates for Hermes Agent. Attach a persistent storage volume (mounted at `/data`) so API keys, Telegram session memory, and custom Sui tools persist across restarts.
  - **Why it wins for hackathons:** You get a live public web URL for the Hermes Admin Dashboard and an active Telegram gateway with zero infrastructure management.

### How Giam Siap Repo would look like

```
giam-siap/
├── contracts/          # Sui Move smart contracts (ProcurementOrder, OwnerCap, etc.)
├── agent/              # Hermes AI Agent (Telegram gateway, price scraper, Sui PTB builder)
├── dashboard/           # Next.js / React monitoring UI (Escrow tracker & live logs)
├── .env.example         # Shared environment config template
└── README.md            # System architecture, pitch deck summary, and setup guide
```

---

### Why this idea need a blockchain?

Traditional Web2 systems struggle with automated micro-settlements, cross-vendor trust, and automated financial authority. Smart contracts solve this through:

- **Trustless Escrow:** Restaurant owners lock funds into a smart contract commitment without risking capital upfront to unverified suppliers.
- **Programmable Execution:** An AI agent cannot directly "spend" a traditional bank account safely without massive security risks. On Sui, an AI agent can be granted scoped smart contract authority to trigger payments *only* when explicit constraints (target price) are verified.
- **Instant Finality & Auditing:** Eliminates traditional 30-to-90-day payment clearing windows for vendors while keeping an immutable ledger of market pricing and transactions.

### Benefits for Both Sides

**For SME Restaurant / Cafe Owners**

- **Automated Savings:** The AI agent monitors supplier price fluctuations 24/7, instantly purchasing inventory the moment vendor prices dip to the owner's target budget.
- **Operational Efficiency:** Eliminates manual price comparison, phone calls, and invoice processing.
- **Capital Security:** Escrow guarantees funds are only disbursed when contract conditions are met.

**For Suppliers & Vendors**

- **Instant Liquidity:** Receive immediate stablecoin payout upon order matching and execution instead of waiting weeks for net-30 invoice settlements.
- **Zero Counterparty Risk:** Guaranteed payment backed by locked smart contract funds before dispatching goods.
- **Direct Demand Signals:** Suppliers can view aggregate on-chain buy orders (demand targets) and adjust their pricing dynamically to clear inventory.

### Why Sui Suits This Idea Best

- **zkLogin:** Restaurant owners and vendors don't want to manage seed phrases or Web3 wallets. zkLogin allows them to sign up using standard Web2 Google or email logins.
- **Sponsored Transactions:** You can sponsor gas fees so SME users interact with the app without ever needing to purchase or hold native SUI tokens for gas.
- **Programmable Transaction Blocks (PTBs):** You can batch order creation, escrow lock, price validation, and supplier settlement into a single atomic execution step.
- **Object-Centric Architecture:** Move allows you to model each procurement request as a unique, stateful on-chain Object (`OrderObject: Draft -> Escrowed -> Fulfilled`).
