import fs from 'fs';
import { clusterApiUrl, ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Wallet } from "@project-serum/anchor";
import dexterityTs from "@hxronetwork/dexterity-ts";
const dexterity = dexterityTs.default;

var zero = dexterity.Fractional.Zero();

const MAX_COMPUTE_UNITS = 1400000; // 1.4m is solana's max

function getEV(key, otherwise, parseNumba = true) {
    if (!process.env.hasOwnProperty(key)) {
        if (typeof otherwise !== 'undefined') {
            return otherwise;
        }
        console.error('The environment variable', key, 'must be set');
        process.exit();
    }
    let v = process.env[key];
    if (parseNumba) {
        v = parseInt(v);
        if (isNaN(v)) {
            if (typeof otherwise !== 'undefined') {
                return otherwise;
            }
            console.error('The environment variable', key, 'must be set');
            process.exit();
        }
    }
    return v;
}

const trgPubkey = new dexterity.web3.PublicKey(getEV('TRG', undefined, false));
const mpgPubkey = new dexterity.web3.PublicKey(getEV('MPG', '4cKB5xKtDpv4xo6ZxyiEvtyX3HgXzyJUS1Y8hAfoNkMT', false));

// let buf = readJsonFileToUint8Array('../dexterity/target/deploy/mpg-keypair.json');
// const mpgKp = Keypair.fromSecretKey(buf);
// const mpgPubkey = mpgKp.publicKey;


function readJsonFileToUint8Array(filePath) {
    const jsonContent = fs.readFileSync(filePath, 'utf8');
    const jsonArray = JSON.parse(jsonContent);
    const uint8Array = new Uint8Array(jsonArray);
    return uint8Array;
}

const rpc = getEV('RPC', 'http://localhost:8899/', false);
console.log('rpc:', rpc);

// create a new wallet and airdrop it some SOL
const keypair = Keypair.fromSecretKey(readJsonFileToUint8Array('my_key.json'));
const wallet = new Wallet(keypair);

const connection = new Connection(rpc, "confirmed");

// get the latest manifest
const manifest = await dexterity.getManifest(rpc, false, wallet);

console.log('updating covariance metadatas...');
await manifest.updateCovarianceMetadatas();
console.log('success');

const mpgPkStr = mpgPubkey.toBase58();
console.log('mpg pubkey:', mpgPkStr);

console.log('fetching orderbooks for the desired mpg...');
await manifest.updateOrderbooks(mpgPubkey);
console.log('successfully fetched orderbooks for the desired mpg!');

let desiredMpg, desiredOrderbooks;
for (const [pkStr, { pubkey, mpg, orderbooks }] of manifest.fields.mpgs) {
    if (mpgPkStr === pkStr) {
        desiredMpg = mpg;
        desiredOrderbooks = orderbooks;
        break;
    }
}
if (!desiredMpg) {
    console.log('failed to find mpg!', manfiest.fields?.mpg);
    process.exit();
}
console.log('found mpg object!');

const TRG_PUBKEY = new PublicKey(trgPubkey);

// create a trader
const trader = new dexterity.Trader(manifest, TRG_PUBKEY);
const holdOffOnVarianceCacheUpdate = new Set();

let lastPortfolioValue = dexterity.Fractional.Zero();
let lastPositionValue = dexterity.Fractional.Zero();
let lastNetCash = dexterity.Fractional.Zero();
let lastPnL = dexterity.Fractional.Zero();

function logTrader() {
    console.log(
        "trader [" + trader.traderRiskGroup.toBase58().slice(0, 4) + "]",
        "Portfolio Value:",
        trader.getPortfolioValue().toString(),
        "Position Value:",
        trader.getPositionValue().toString(),
        "Net Cash:",
        trader.getNetCash().toString(),
        "PnL:",
        trader.getPnL().toString()
    );
}

// define what happens when our trader changes in any way
const onUpdate = trader => async thing => {
    try {
        const portfolioValue = trader.getPortfolioValue();
        const positionValue = trader.getPositionValue();
        const netCash = trader.getNetCash();
        const pnl = trader.getPnL();
        let somethingChanged = false;
        if (!portfolioValue.eq(lastPortfolioValue)) {
            lastPortfolioValue = portfolioValue;
            somethingChanged = true;
        }
        if (!positionValue.eq(lastPositionValue)) {
            lastPositionValue = positionValue;
            somethingChanged = true;
        }
        if (!netCash.eq(lastNetCash)) {
            lastNetCash = netCash;
            somethingChanged = true;
        }
        if (!pnl.eq(lastPnL)) {
            lastPnL = pnl;
            somethingChanged = true;
        }
        if (somethingChanged) {
            console.log('something changed!');
            logTrader();
        }
    } catch (e) {
        console.error(e);
        console.error(e.logs);
    }
};

console.log(
  `Wallet: ${wallet.publicKey.toBase58()} TRG: ${TRG_PUBKEY.toBase58()}`
);

// call connect() so updates are streamed
await trader.connect(onUpdate(trader));
console.log('fetching address lookup table account...');
await trader.fetchAddressLookupTableAccount();
console.log('successfully fetched address lookup table account...');

console.log('cancelling all orders at startup...');
const cancelAllOrders = async _ => {
    try {
        await trader.cancelAllOrders([]);
    } catch (e) {
        console.error('failed to cancel all orders!');
        console.error(e.logs);
        console.error(e);
        process.exit();
    }
}
await cancelAllOrders();

function getProductAndMarketState(name) {
    let p, ms;
    for (const [productName, { index, product }] of dexterity.Manifest.GetProductsOfMPG(trader.mpg)) {
        const meta = dexterity.productToMeta(product);
        if (productName.includes(name)) {
            p = product.outright.outright;
            ms = desiredOrderbooks.get(meta.orderbook.toBase58());
            break;
        }
    }
    if (!p || !ms) {
        console.log('failed to desired product or desired market state!', p, ms);
        process.exit();
    }
    return { product: p, marketState: ms };
}

let quotePeriodMs = getEV('QUOTE_PERIOD_MS', 5000);
let numLevels = getEV('NUM_LEVELS', 5);
let bps = dexterity.Fractional.New(getEV('BPS', 100), 4);
let intralevelBps = dexterity.Fractional.New(getEV('INTRALEVEL_BPS', 100), 4);
let qtyNotional = dexterity.Fractional.New(getEV('QTY_NOTIONAL', 5), 0); // default to $5 notional value order sizes
let offsetBps = dexterity.Fractional.New(getEV('OFFSET_BPS', 0), 4);
let productNameFilter = getEV('PRODUCT_NAME_FILTER', '', false);
let cancelPeriodMs = getEV('CANCEL_PERIOD_MS', 60000);
let maxOrdersRatio = getEV('MAX_ORDERS_RATIO', 2);


const makeMarkets = async _ => {
    const UNINITIALIZED = new dexterity.web3.PublicKey('11111111111111111111111111111111');
    for (const [productName, obj] of dexterity.Manifest.GetProductsOfMPG(trader.mpg)) {
        if (productNameFilter !== '' && !productName.includes(productNameFilter)) {
            continue;
        }
        const { index: productIndex, product } = obj;
        const meta = dexterity.productToMeta(product);
        if (meta.productKey.equals(UNINITIALIZED)) {
            continue;
        }
        if (product.combo?.combo) {
            continue;
        }
        const index = dexterity.Manifest.GetIndexPrice(trader.markPrices, meta.productKey);
        const lotSize = qtyNotional.div(index).round_down(new dexterity.BN(meta.baseDecimals));
        console.log('quoting on', productName, 'around index', index.toString(4, true), 'with offset bps =', offsetBps.mul(dexterity.Fractional.New(10000, 0)).toString(4, true));
        let price;

        price = index.mul(dexterity.Fractional.One().add(bps).add(offsetBps));
        console.log('mm\'s best offer:', price.toString(4, true));
        for (let i = 0; i < numLevels; i++) {
            const clientOrderId = new dexterity.BN(index*100+i);
            try {
                trader.sendV0Tx([
                    trader.getCancelOrderIx(productIndex, new dexterity.BN(0), true, clientOrderId),
                    trader.getNewOrderIx(productIndex, false, price, lotSize, false, null, null, clientOrderId)
                ]);
            } catch (e) {
                console.error('failed to send replace for level', i, 'of asks of', productName, 'price', price.toString(4, true), 'qty', lotSize.toString());
                console.error(e);
                console.error(e.logs);
            }
            price = price.mul(dexterity.Fractional.One().add(intralevelBps));
        }

        price = index.mul(dexterity.Fractional.One().sub(bps).add(offsetBps));
        console.log('mm\'s best bid:', price.toString(4, true));
        for (let i = 0; i < numLevels; i++) {
            const clientOrderId = new dexterity.BN(index*100+numLevels+i);
            try {
                trader.sendV0Tx([
                    trader.getCancelOrderIx(productIndex, new dexterity.BN(0), true, clientOrderId),
                    trader.getNewOrderIx(productIndex, true, price, lotSize, false, null, null, clientOrderId)
                ]);
            } catch (e) {
                console.error('failed to send replace for level', i, 'of bids of', productName, 'price', price.toString(4, true), 'qty', lotSize.toString());
                console.error(e);
                console.error(e.logs);
            }
            price = price.mul(dexterity.Fractional.One().sub(intralevelBps));
        }
    }
};

const backupCancelLoop = async _ => {
    await trader.update();
    if (trader.getOpenOrders().size > numLevels * 2 * maxOrdersRatio) {
        await cancelAllOrders();
    }
};

await makeMarkets();
setInterval(makeMarkets, quotePeriodMs);
setInterval(backupCancelLoop, cancelPeriodMs);
