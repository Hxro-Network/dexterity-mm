# Running a Market Maker on Dexterity

Disclaimer: Unaudited Software - No Liability - As-Is Use

Trading on Dexterity is not allowed in the US and other jurisdictions; you could lose all your money and more with this script.

Please be advised that this software is provided on an "as-is" basis and has not undergone any formal auditing by third-party organizations. We make no representations or warranties of any kind, express or implied, about the completeness, accuracy, reliability, suitability, or availability of this software for any purpose. Any reliance you place on such information or use of this software is strictly at your own risk.

We disclaim all liability for losses, damages, or negative consequences you may incur due to the use or misuse of this software, including but not limited to financial loss and data breaches. It is strongly advised that you consult with qualified legal and financial professionals before making any decisions related to the use of this software.

By using this software, you acknowledge that you could potentially lose all your money, data, or other assets, and agree that we will not be liable for any such losses or damages under any circumstances.

# Getting Started

## Requirements

1. git
2. node version >= 18
3. (optional) yarn; if you don't use yarn, replace "yarn" with "npm" in all the following commands

Lookup how to install git. [NVM](https://github.com/nvm-sh/nvm) manages node installations for you.

## First-Time Setup

```
# clone the source code for this market maker
git clone git@github.com:Hxro-Network/dexterity-mm.git
cd dexterity-mm

# select a node version of at least 18
nvm use 18

# install it
yarn install
```

## Running the MM

1. You must create a trading account (TRG) and deposit funds before running this script.
2. Place the private key that owns your TRG inside the cloned dexterity-mm directory. It must be named `my_key.json`. (Or modify the script to accept it as an environment variable).
3. Run the MM with desired parameters 

The MM quotes around the index price of each product on a Dexterity Market Product Group (MPG).

The MM has the following parameters, which are set via environment variables:

| Key            | Default              | Description                                                                 |
| -------------- | -------------------- | --------------------------------------------------------------------------- |
| HOT_WALLET            | my_key.json | Path to your hot wallet's private key (JSON file)                                                                         |
| RPC            | http://localhost:8899/ | -                                                                         |
| MPG            | Bluechip MPG (see below) | Public key of the Dexterity markets (MPG).                                            |
| TRG            | -                    | Your trading account public key.                                            |
| QUOTE_PERIOD_MS| 5000                 | How many milliseconds between updating quotes                               |
| CANCEL_PERIOD_MS| 60000                 | How many milliseconds between verifying there are not more than MAX_ORDERS_RATIO * 2 * NUM_LEVEL orders (and cancelling all if so)                               |
| NUM_LEVELS     | 5                    | Number of levels to quote per side of each book                             |
| BPS            | 100                  | "Radius from index price to begin quoting at, specified in basis points"    |
| INTERLEVEL_BPS | 100                  | Number of basis points between levels on the same side of the book          |
| QTY_NOTIONAL   | 5                    | Notional dollar value of lot sizes (using index price)                      |
| OFFSET_BPS     | 0                    | Offset from index price in bps (to quote around) (can be negative)                      | 
| MIN_BPS_TO_REQUOTE     | 50                    | Minimum price movement in BPS before replacing quotes                      | 
| MAX_ORDERS_RATIO     | 2                    | Verifies there are not more than MAX_ORDERS_RATIO * 2 * NUM_LEVEL orders (and cancels if so) (see CANCEL_PERIOD_MS)                      | 
| MIN_HEALTH_RATIO     | 0.1                    | Minimum ratio of excess initial margin to portfolio value (cancels if too low) (see CANCEL_PERIOD_MS)                      | 
| PRODUCT_NAME_FILTER     | ''                    | Only make on products with names that include this substring                      | 
| DRY_RUN     | 'false'                    | If 'true', do not send transactions to the blockchain                      | 
| COMBOS_QUOTE_INDEX_PRICE     | 'false'                    | If 'true', quote combos around the weighted sum of the index prices of the legs, rather than the midpoints of the legs                      | 
| SKIP_MARK_PRICES     | 'false'                    | If 'true', skips packing in "update mark prices" instructions. Skipping this reduces compute cost but the transaction could fail if mark prices are out of date.                      | 
| SKIP_CANCELS     | 'false'                    | If 'true', skips packing in cancel instructions. Orders never get canceled except by the backup cancel logic. Not recommended. It's likely you'll want to fork this repository and write your own cancellation logic.                      | 
| LEGGER     | 'false'                    | If 'true', run the legger bot instead of the mm. See "Running the Legger Bot" below.                      | 
| LEGGER_EDGE     | 5                   | The legger bot's edge in bps. This factors into quote prices to produce an expected profit (in bps) for each fill + aggression.                      | 


Set your environment variable and run the mm with `yarn start`. For example:

```
RPC=REPLACE_WTIH_URL_OF_YOUR_RPC TRG=REPLACE_WITH_TRG_PUBKEY yarn start
```

STAKECHIP MPG: LSTqd6kXfMcMmVj63TdFfXvwSEYSkQVcT6GrwH4Ki3h

## Running the Legger Bot

The legger bot runs a strategy that quotes in the legs of combos with prices such that, when filled, the bot can aggressively take the combo and other leg to get flat with a profit.

To run the legger bot set `LEGGER=true` and !!! WARNING !!! be sure to set `PRODUCT_NAME_FILTER=` to exactly ONE combo. Multiple combos are not supported yet; the code is written to infer the combo and other leg from a given leg's public key, but this inference is not well-defined, since one leg could be a part of multiple combos. For example, MSOL is part of both MSOL-JSOL and MSOL-SOL; it is ambiguous which combo and which other leg you're referring to when calling `getComboAndOtherOutright(MSOL)`. This problem is avoided when filtering the products to just one combo and its legs, which can be done by simplying specifying the combo. Example: `PRODUCT_NAME_FILTER=MSOL-SOL`.

```
PRODUCT_NAME_FILTER=MSOL-SOL LEGGER=true yarn start
```
