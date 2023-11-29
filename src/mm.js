import BN from 'bn.js';
import fs from 'fs';
import { EventFill, EventQueue as AaobEventQueue, EventQueueHeader } from '@bonfida/aaob';
import { clusterApiUrl, ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Wallet } from "@project-serum/anchor";
import dexterityTs from "@hxronetwork/dexterity-ts";
const dexterity = dexterityTs.default;

Object.defineProperty(EventQueueHeader, 'LEN', {
    configurable: true,
    writable: true,
    value: 33
});

var zero = dexterity.Fractional.Zero();

const MAX_COMPUTE_UNITS = 1400000; // 1.4m is solana's max
const UNINITIALIZED = new dexterity.web3.PublicKey('11111111111111111111111111111111');
const MAX_ASK = new BN(2).pow(new BN(63)).subn(1);
const MIN_BID = new BN(2).pow(new BN(63)).neg();
const ZERO_BN = new BN(0);

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
const mpgPubkey = new dexterity.web3.PublicKey(getEV('MPG', 'LSTqd6kXfMcMmVj63TdFfXvwSEYSkQVcT6GrwH4Ki3h', false));

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

let hotWalletPath = getEV('HOT_WALLET', 'my_key.json', false);

// create a new wallet and airdrop it some SOL
const keypair = Keypair.fromSecretKey(readJsonFileToUint8Array(hotWalletPath));
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
    const healthRatio = trader.getExcessInitialMargin().div(trader.getPortfolioValue()).mul(dexterity.Fractional.New(100, 0));
    console.log(
        "trader [" + trader.traderRiskGroup.toBase58().slice(0, 4) + "]",
        "Required % Decrease in Portfolio Value to Unhealthy State:",
        healthRatio.toString(2),
        "Portfolio Value:",
        trader.getPortfolioValue().toString(),
        "Position Value:",
        trader.getPositionValue().toString(),
        "Net Cash:",
        trader.getNetCash().toString(),
        "Required Maintenance Margin:",
        trader.getRequiredMaintenanceMargin().toString(2, true),
        "Required Initial Margin:",
        trader.getRequiredInitialMargin().toString(2, true),
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
try {
    await trader.fetchAddressLookupTableAccount();
} catch (e) {
    console.log('failed to fetch address lookup table account with error', e);
}

let productNameFilter = getEV('PRODUCT_NAME_FILTER', '', false);
let isDryRun = getEV('DRY_RUN', 'false', false) === 'true';
let skipMarkPrices = getEV('SKIP_MARK_PRICES', 'false', false) === 'true';
let skipCancels = getEV('SKIP_CANCELS', 'false', false) === 'true';
let combosQuoteIndexPrice = getEV('COMBOS_QUOTE_INDEX_PRICE', 'false', false) === 'true';
let isLegger = getEV('LEGGER', 'false', false) === 'true';
let leggerEdgeBps = dexterity.Fractional.New(getEV('LEGGER_EDGE', 5), 4);

const getProducts = _ => {
    const allProducts = dexterity.Manifest.GetProductsOfMPG(trader.mpg);
    const products = new Map();
    if (!isLegger) {
        for (const [productName, obj] of allProducts) {
            const { index: productIndex, product } = obj;
            const meta = dexterity.productToMeta(product);
            if (productNameFilter !== '' && !productName.includes(productNameFilter)) {
                continue;
            }
            if (meta.productKey.equals(UNINITIALIZED)) {
                continue;
            }
            products.set(meta.productKey.toBase58(), obj);
        }
    } else {
        for (const [productName, obj] of allProducts) {
            const { index: productIndex, product } = obj;
            const meta = dexterity.productToMeta(product);
            if (productNameFilter !== '' && !productName.includes(productNameFilter)) {
                continue;
            }
            // notice the product name filter applies only to combo names and not outright names, in the legger bot case
            if (meta.productKey.equals(UNINITIALIZED)) {
                continue;
            }
            const combo = product.combo?.combo;
            if (!combo) {
                continue;
            }
            for (let i = 0; i < combo.numLegs.toNumber(); i++) {
                const leg = combo.legs[i];
                for (const [productName, obj] of allProducts) {
                    // notice the product name filter applies only to combo names and not outright names, in the legger bot case
                    const { index: productIndex, product } = obj;
                    const meta = dexterity.productToMeta(product);
                    if (meta.productKey.equals(leg.productKey)) {
                        products.set(meta.productKey.toBase58(), obj);
                    }
                }
            }
            // notice we don't add the combo itself
        }
    }
    return products;
};

console.log('cancelling all orders at startup...');
const cancelAllOrders = async _ => {
    const productNames = [];
    for (const [productKey, { index, product }] of getProducts()) {
        productNames.push(dexterity.productToName(product));
    }
    try {
        if (!isDryRun) {
            await trader.cancelAllOrders(productNames, undefined, true);
        } else {
            console.log('DID NOT send tx because it\'s a dry run');
        }
    } catch (e) {
        console.error('failed to cancel all orders!');
        console.error(e.logs);
        console.error(e);
        process.exit();
    }
}
await cancelAllOrders();

let quotePeriodMs = getEV('QUOTE_PERIOD_MS', 5000);
let numLevels = getEV('NUM_LEVELS', 5);
let bps = dexterity.Fractional.New(getEV('BPS', 100), 4);
let interlevelBps = dexterity.Fractional.New(getEV('INTERLEVEL_BPS', 100), 4);
let qtyNotional = dexterity.Fractional.New(getEV('QTY_NOTIONAL', 5), 0); // default to $5 notional value order sizes
let offsetBps = dexterity.Fractional.New(getEV('OFFSET_BPS', 0), 4);
let cancelPeriodMs = getEV('CANCEL_PERIOD_MS', 60000);
let maxOrdersRatio = getEV('MAX_ORDERS_RATIO', 4);
let minHealthRatio = dexterity.Fractional.FromString(getEV('MIN_HEALTH_RATIO', '0.10', false));
let minBpsToRequote = dexterity.Fractional.New(getEV('MIN_BPS_TO_REQUOTE', 50), 4);

var lastBestBid = new Map();
var lastBestAsk = new Map();

const getComboAndOtherOutright = async (productKey, products) => {
    let [comboIndex, comboBid, comboAsk, otherOutrightIndex, otherOutrightBid, otherOutrightAsk, thisRatio] = [null, null, null, null, null, null, null];
    for (const [productName, obj] of dexterity.Manifest.GetProductsOfMPG(trader.mpg)) {
        const { index: productIndex, product } = obj;
        const meta = dexterity.productToMeta(product);
        const combo = product.combo?.combo;
        if (!combo) {
            continue;
        }
        comboIndex = productIndex;
        let otherOutrightProductKey = null;
        for (let i = 0; i < combo.numLegs.toNumber(); i++) {
            const leg = combo.legs[i];
            if (leg.productKey.equals(productKey)) {
                thisRatio = leg.ratio.toNumber();
                continue;
            }
            otherOutrightProductKey = leg.productKey;
        }
        if (otherOutrightProductKey === null || thisRatio === null || !products.has(otherOutrightProductKey.toString())) {
            continue;
        }
        for (const [productName, obj] of dexterity.Manifest.GetProductsOfMPG(trader.mpg)) {
            const { index: productIndex, product } = obj;
            const meta = dexterity.productToMeta(product);
            if (!meta.productKey.equals(otherOutrightProductKey)) {
                continue;
            }
            otherOutrightIndex = productIndex;
            const ask = dexterity.Fractional.From(meta.prices.ask);
            const bid = dexterity.Fractional.From(meta.prices.bid);
            otherOutrightAsk = (ask.m.eq(MAX_ASK) && ask.exp.eq(ZERO_BN)) ? dexterity.Fractional.Nan() : ask;
            otherOutrightBid = (bid.m.eq(MIN_BID) && bid.exp.eq(ZERO_BN)) ? dexterity.Fractional.Nan() : bid;
        }
        {
            const ask = dexterity.Fractional.From(meta.prices.ask);
            const bid = dexterity.Fractional.From(meta.prices.bid);
            comboAsk = (ask.m.eq(MAX_ASK) && ask.exp.eq(ZERO_BN)) ? dexterity.Fractional.Nan() : ask;
            comboBid = (bid.m.eq(MIN_BID) && bid.exp.eq(ZERO_BN)) ? dexterity.Fractional.Nan() : bid;
        }
        if (!(comboIndex !== null && comboBid !== null && comboAsk !== null && otherOutrightIndex !== null && otherOutrightBid !== null && otherOutrightAsk !== null && thisRatio !== null)) {
            console.error('!(comboIndex !== null && comboBid !== null && comboAsk !== null && otherOutrightIndex !== null && otherOutrightBid !== null && otherOutrightAsk !== null && thisRatio !== null)');
            console.error(comboIndex, comboBid?.toString(), comboAsk?.toString(), otherOutrightIndex, otherOutrightBid?.toString(), otherOutrightAsk?.toString(), thisRatio);
            console.error('cancelling all orders and exiting!');
            await cancelAllOrders();
            process.exit();
        }
        return { comboIndex, comboBid, comboAsk, otherOutrightIndex, otherOutrightBid, otherOutrightAsk, thisRatio };
    }
    console.error('failed to find combo and other outright for outright with key', productKey.toString());
    console.error('cancelling all orders and exiting!');
    await cancelAllOrders();
    process.exit();
}

const getQuotePrice = async (trader, product, meta) => {
    try {
        if (!isLegger) {
            const index = dexterity.Manifest.GetIndexPrice(trader.markPrices, meta.productKey, trader.mpg);;
            const midpoint = dexterity.Manifest.GetMidpointPrice(trader.mpg, meta.productKey)
            if (product.combo?.combo) {
                if (combosQuoteIndexPrice || midpoint.isNan()) {
                    return { quote: index, bid: null, ask: null };
                }
                return { quote: midpoint, bid: null, ask: null };
            }
            return { quote: index, bid: null, ask: null };
        }
        // legger logic here
        if (product.combo?.combo) {
            throw new Error('attempted to get quote price on combo but running the legger bot! this should never happen! legger should never quote combos!');
        }
        const { comboBid, comboAsk, otherOutrightBid, otherOutrightAsk, thisRatio } = await getComboAndOtherOutright(meta.productKey, getProducts());
        if (thisRatio === 1) {
            // sell combo and sell the -1 leg (opposite sign of what you'd expect in expr because initially bought and selling back)
            const bid = (comboBid.add(otherOutrightBid)).mul(dexterity.Fractional.One().sub(leggerEdgeBps));
            // buy combo and buy the -1 leg
            const ask = (comboAsk.add(otherOutrightAsk)).mul(dexterity.Fractional.One().add(leggerEdgeBps));
            let quote = (bid.add(ask)).div(dexterity.Fractional.New(2, 0));
            if (quote.isNan()) {
                quote = !bid.isNan() ? bid : (!ask.isNan() ? ask : quote);
            }
            return {
                quote,
                bid,
                ask,
            };
        } else if (thisRatio === -1) {
            // buy combo and sell the +1 leg (negative signs of what you'd in expr because initially bought and selling back)
            const bid = (otherOutrightBid.sub(comboAsk)).mul(dexterity.Fractional.One().sub(leggerEdgeBps));
            // sell combo and buy the +1 leg
            const ask = (otherOutrightAsk.sub(comboBid)).mul(dexterity.Fractional.One().add(leggerEdgeBps));
            let quote = (bid.add(ask)).div(dexterity.Fractional.New(2, 0));
            if (quote.isNan()) {
                quote = !bid.isNan() ? bid : (!ask.isNan() ? ask : quote);
            }
            return {
                quote,
                bid,
                ask,
            };
        } else {
            throw new Error('only (+1, -1) combos are supported! this combo had these ratios: (' + (combo.legs ? combo.legs.map(l => leg.ratio.toNumber()).join(', ') : 'failed to get ratios') + ')');
        }
    } catch (error) {
        console.error(error);
        console.error('cancelling all orders and exiting!');
        await cancelAllOrders();
        process.exit();
    }
}

const makeMarkets = async products => {
    for (const [productKey, obj] of products) {
        const { index: productIndex, product } = obj;
        const productName = dexterity.productToName(product);
        const meta = dexterity.productToMeta(product);
        const { quote, bid, ask } = await getQuotePrice(trader, product, meta);
        let lotSize = qtyNotional.div(quote).abs();
        const baseDecimals = new dexterity.BN(meta.baseDecimals);
        if (lotSize.exp.gt(baseDecimals)) {
                lotSize = lotSize.round_down(baseDecimals);
        }
        let price;

        if (ask !== null && !ask.isNan()) {
            price = ask;
        } else {
            price = quote.mul(dexterity.Fractional.One().add(bps).add(offsetBps));
        }
        if (quote === null || quote.isNan()) {
            console.log('not quoting on', productName.trim(), 'because the combo or the other leg does not have liquidity to take to close the trade, if we get filled');
            continue;
        }
        console.log('quoting on', productName.trim(), 'around ', quote.toString(4, true), 'with lot size ~', lotSize.toString(), 'with offset bps =', offsetBps.mul(dexterity.Fractional.New(10000, 0)).toString(4, true));
        let prevAsk = lastBestAsk.get(productKey) ?? dexterity.Fractional.Nan();
        const askMovement = (price.sub(prevAsk)).abs().div(prevAsk);
        if (askMovement.isNan() || askMovement.gt(minBpsToRequote) || trader.getOpenOrders().size < numLevels * 2 * products.size) {
            lastBestAsk.set(productKey, price.reduced());
            console.log('mm\'s best offer:', price.toString(4, true));
            for (let i = 0; i < numLevels; i++) {
                const clientOrderId = new dexterity.BN(productIndex*100+i);
                try {
                    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS })];
                    if (!skipCancels) {
                        ixs.push(trader.getCancelOrderIx(productIndex, undefined, true, clientOrderId));
                    }
                    if (trader.addressLookupTableAccount && !skipMarkPrices) {
                        ixs.push(trader.getUpdateMarkPricesIx());
                    }
                    ixs.push(trader.getNewOrderIx(productIndex, false, price, lotSize, false, null, null, clientOrderId));
                    if (!isDryRun) {
                        trader.sendV0Tx(ixs);
                    } else {
                        console.log('DID NOT send tx because it\'s a dry run');
                    }
                } catch (e) {
                    console.error('failed to send replace for level', i, 'of asks of', productName.trim(), 'price', price.toString(4, true), 'qty', lotSize.toString());
                    console.error(e);
                    console.error(e.logs);
                }
                price = price.mul(dexterity.Fractional.One().add(interlevelBps));
            }
        } else {
            console.log('not requoting asks because price didn\'t move enough:', askMovement.toString(4), '<', minBpsToRequote.toString(4), '(SEE MIN_BPS_TO_REQUOTE)');
        }

        if (bid !== null && !bid.isNan()) {
            price = bid;
        } else {
            price = quote.mul(dexterity.Fractional.One().sub(bps).add(offsetBps));
        }
        let prevBid = lastBestBid.get(productKey) ?? dexterity.Fractional.Nan();
        const bidMovement = (price.sub(prevBid)).abs().div(prevBid);
        if (bidMovement.isNan() || bidMovement.gt(minBpsToRequote) || trader.getOpenOrders().size < numLevels * 2 * products.size) {
            lastBestBid.set(productKey, price.reduced());
            console.log('mm\'s best bid:', price.toString(4, true));
            for (let i = 0; i < numLevels; i++) {
                const clientOrderId = new dexterity.BN(productIndex*100+numLevels+i);
                try {
                    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_COMPUTE_UNITS })];
                    if (!skipCancels) {
                        ixs.push(trader.getCancelOrderIx(productIndex, undefined, true, clientOrderId));
                    }
                    if (trader.addressLookupTableAccount && !skipMarkPrices) {
                        ixs.push(trader.getUpdateMarkPricesIx());
                    }
                    ixs.push(trader.getNewOrderIx(productIndex, true, price, lotSize, false, null, null, clientOrderId));
                    if (!isDryRun) {
                        trader.sendV0Tx(ixs);
                    } else {
                        console.log('DID NOT send tx because it\'s a dry run');
                    }
                } catch (e) {
                    console.error('failed to send replace for level', i, 'of bids of', productName.trim(), 'price', price.toString(4, true), 'qty', lotSize.toString());
                    console.error(e);
                    console.error(e.logs);
                }
                price = price.mul(dexterity.Fractional.One().sub(interlevelBps));
            }
        } else {
            console.log('not requoting bids because price didn\'t move enough:', bidMovement.toString(4), '<', minBpsToRequote.toString(4), '(SEE MIN_BPS_TO_REQUOTE)');
        }
    }
};

const backupCancelLoop = async _ => {
    await trader.update();
    const healthRatio = trader.getExcessInitialMargin().div(trader.getPortfolioValue());    
    let numProducts = getProducts().size;
    if (trader.getOpenOrders().size > numLevels * 2 * numProducts * maxOrdersRatio || healthRatio.lt(minHealthRatio)) {
        console.log('cancelling all because saw too many open orders or health ratio too bad. open:', trader.getOpenOrders().size, 'max:', numLevels * 2 * maxOrdersRatio, 'health ratio:', healthRatio.toString(2), 'min:', minHealthRatio.toString(2));
        await cancelAllOrders();
        await makeMarkets();
    }
};

console.log('PRODUCT_NAME_FILTER:', productNameFilter);
console.log('Quoting on', getProducts().size, 'products');
console.log('Quoting on:', Array.from(getProducts()).map(([pk, obj]) => dexterity.productToName(obj.product).trim()).join('\n'));
if (isLegger) {
    console.log('Running LEGGER bot instead of MM');
}

const productKeyToEventQueue = new Map();

await makeMarkets(getProducts());
if (!isLegger) {
    setInterval(_ => {
        const products = getProducts();
        makeMarkets(products);
    }, quotePeriodMs);
} else {
    const { orderbooks } = trader.manifest.fields.mpgs.get(trader.marketProductGroup.toBase58());
    for (const [productKey, { index, product }] of getProducts()) {
        const meta = dexterity.productToMeta(product);
        const orderbook = orderbooks.get(meta.orderbook.toBase58());
        productKeyToEventQueue.set(productKey, manifest.accountSubscribe(
            orderbook.eventQueue,
            (data, manifest) => {
                return AaobEventQueue.parse(orderbook.callBackInfoLen, data);
            },
            async eventQueue => {
                const seqNum = eventQueue.header.seqNum.toNumber();
                const count = eventQueue.header.count.toNumber();
                for (let i = 0; i < count; i++) {
                    try {
                        const event = eventQueue.parseEvent(i);
                        if (event instanceof EventFill) {
                            const maker = new dexterity.web3.PublicKey(event.makerCallbackInfo.slice(0, 32));
                            if (!maker.equals(trader.traderRiskGroup)) {
                                continue;
                            }
                            const orderId = event.makerOrderId.toString();
                            if (!seenOrderIds.has(orderId)) {
                                continue;
                            }
                            const baseQty = new dexterity.Fractional(event.baseSize, meta.baseDecimals);
                            const weAreTheAsk = event.takerSide === 0;
                            const { comboIndex, comboBid, comboAsk, otherOutrightIndex, otherOutrightBid, otherOutrightAsk, thisRatio } = await getComboAndOtherOutright(new dexterity.web3.PublicKey(productKey), getProducts());
                            try {
                                const comboSize = baseQty;
                                const otherOutrightSize = baseQty;
                                const isIOC = true;
                                const ixs = [];
                                if (trader.addressLookupTableAccount && !skipMarkPrices) {
                                    ixs.push(trader.getUpdateMarkPricesIx());
                                }
                                let comboIsBid = null;
                                let comboPrice = null;
                                let otherOutrightIsBid = null;
                                let otherOutrightPrice = null;
                                if (thisRatio === 1) {
                                    if (!weAreTheAsk) {
                                        // just went long the +1 leg so
                                        // 1. short the combo
                                        // 2. short the other leg (the -1 leg)
                                        comboIsBid = false;
                                        comboPrice = comboBid.mul(dexterity.Fractional.New(90, 2));
                                        otherOutrightIsBid = false;
                                        otherOutrightPrice = otherOutrightBid.mul(dexterity.Fractional.New(90, 2));
                                    } else {
                                        // just went short the +1 leg so
                                        // 1. long the combo
                                        // 2. long the other leg (the -1 leg)
                                        comboIsBid = true;
                                        comboPrice = comboBid.mul(dexterity.Fractional.New(110, 2));
                                        otherOutrightIsBid = true;
                                        otherOutrightPrice = otherOutrightBid.mul(dexterity.Fractional.New(110, 2));
                                    }
                                } else if (thisRatio === -1) {
                                    if (!weAreTheAsk) {
                                        // just went long the -1 leg so
                                        // 1. short the combo
                                        // 2. long the other leg (the +1 leg)
                                        comboIsBid = false;
                                        comboPrice = comboBid.mul(dexterity.Fractional.New(90, 2));
                                        otherOutrightIsBid = true;
                                        otherOutrightPrice = otherOutrightBid.mul(dexterity.Fractional.New(110, 2));
                                    } else {
                                        // just went short the -1 leg so
                                        // 1. long the combo
                                        // 2. short the other leg (the +1 leg)
                                        comboIsBid = true;
                                        comboPrice = comboBid.mul(dexterity.Fractional.New(110, 2));
                                        otherOutrightIsBid = false;
                                        otherOutrightPrice = otherOutrightBid.mul(dexterity.Fractional.New(90, 2));
                                    }
                                } else {
                                    throw new Error('only (+1, -1) combos are supported! getComboAndOtherOutright');
                                }
                                if (!(comboIndex !== null && comboBid !== null && comboAsk !== null && otherOutrightIndex !== null && otherOutrightBid !== null && otherOutrightAsk !== null)) {
                                    console.error('!(comboIndex !== null && comboBid !== null && comboAsk !== null && otherOutrightIndex !== null && otherOutrightBid !== null && otherOutrightAsk !== null)');
                                    console.error(comboIndex, comboBid?.toString(), comboAsk?.toString(), otherOutrightIndex, otherOutrightBid?.toString(), otherOutrightAsk?.toString());
                                    console.error('cancelling all orders and exiting!');
                                    await cancelAllOrders();
                                    process.exit();
                                }                                
                                ixs.push(trader.getNewOrderIx(comboIndex, comboIsBid, comboPrice, comboSize, isIOC));
                                ixs.push(trader.getNewOrderIx(otherOutrightIndex, otherOutrightIsBid, otherOutrightPrice, otherOutrightSize, isIOC));
                                if (!isDryRun) {
                                    trader.sendV0Tx(ixs);
                                } else {
                                    console.log('DID NOT send tx because it\'s a dry run');
                                }
                            } catch (e) {
                                console.error('failed to send legger taker order for combo', productToName(combo).trim());
                                console.error(e);
                                console.error(e.logs);
                            }
                        }
                    } catch (e) {
                        console.error('failed to parse event from event queue! index', i, 'error', e);
                    }
                }
            },
        ));
    }

    setInterval(_ => {
        const products = getProducts();
        makeMarkets(products);
    }, quotePeriodMs);
}
setInterval(backupCancelLoop, cancelPeriodMs);
