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
| RPC            | http://localhost:8899/ | -                                                                         |
| MPG            | Bluechip MPG (see below) | Public key of the Dexterity markets (MPG).                                            |
| TRG            | -                    | Your trading account public key.                                            |
| QUOTE_PERIOD_MS| 5000                 | How many milliseconds between updating quotes                               |
| CANCEL_PERIOD_MS| 60000                 | How many milliseconds between verifying there are not more than MAX_ORDERS_RATIO * 2 * NUM_LEVEL orders (and cancelling all if so)                               |
| NUM_LEVELS     | 5                    | Number of levels to quote per side of each book                             |
| BPS            | 100                  | "Radius from index price to begin quoting at, specified in basis points"    |
| INTRALEVEL_BPS | 100                  | Number of basis points between levels on the same side of the book          |
| QTY_NOTIONAL   | 5                    | Notional dollar value of lot sizes (using index price)                      |
| OFFSET_BPS     | 0                    | Offset from index price in bps (to quote around) (can be negative)                      | 
| MAX_ORDERS_RATIO     | 2                    | Verifies there are not more than MAX_ORDERS_RATIO * 2 * NUM_LEVEL orders (and cancels if so) (see CANCEL_PERIOD_MS)                      | 
| MIN_HEALTH_RATIO     | 0.1                    | Minimum ratio of excess initial margin to portfolio value (cancels if too low) (see CANCEL_PERIOD_MS)                      | 
| PRODUCT_NAME_FILTER     | ''                    | Only make on products with names that include this substring                      | 


Set your environment variable and run the mm with `yarn start`. For example:

```
RPC=REPLACE_WTIH_URL_OF_YOUR_RPC TRG=REPLACE_WITH_TRG_PUBKEY yarn start
```


BLUECHIP MPG: 4cKB5xKtDpv4xo6ZxyiEvtyX3HgXzyJUS1Y8hAfoNkMT
