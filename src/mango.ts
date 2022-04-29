import {
    Commitment,
} from '@solana/web3.js';
import {
    Config,
    getMarketByBaseSymbolAndKind,
    GroupConfig,
    makePlacePerpOrderInstruction,
    MangoAccount,
    MangoCache,
    MangoClient,
    MangoGroup,
    PerpMarket,
    getPerpMarketByBaseSymbol,
    IDS,
    PerpMarketConfig,
    Cluster
} from '@blockworks-foundation/mango-client';
import { BN } from '@drift-labs/sdk';
import { Account, Connection, PublicKey } from "@solana/web3.js";

import { RestClient } from 'ftx-api';
import fs from 'fs';
import path from 'path';
import os from 'os';

const paramsFileName = process.env.PARAMS || 'default.json';
const params = JSON.parse(
    fs.readFileSync(
        path.resolve(__dirname, `../params/${paramsFileName}`),
        'utf-8',
    ),
);
const config = new Config(IDS);
const groupIds = config.getGroupWithName(params.group) as GroupConfig;
if (!groupIds) {
    throw new Error(`Group ${params.group} not found`);
}

export default class MangoArbClient {
    solPerpMarket: PerpMarket;
    connection: Connection;
    groupConfig: GroupConfig;
    client: MangoClient;
    mangoAccount: MangoAccount;
    mangoGroup: MangoGroup;
    owner: Account;
    solMarketIndex: number
    ftx: RestClient;
    btcPerpMarket: PerpMarket;
    ethPerpMarket: PerpMarket;
    btcMarketIndex: number;
    ethMarketIndex: number;

    constructor(url: string) {
        const cluster = groupIds.cluster as Cluster;
        const mangoGroupKey = groupIds.publicKey;
        this.connection = new Connection(
            process.env.ENDPOINT_URL || config.cluster_urls[cluster],
            'processed' as Commitment,
        );
    }

    async init(privateKey) {
        this.client = new MangoClient(this.connection, this.groupConfig.mangoProgramId);
        // load group & market
        // const solPerpMarketConfig = getMarketByBaseSymbolAndKind(
        //     this.groupConfig,
        //     'SOL',
        //     'perp',
        // );
        // const btcPerpMarketConfig = getMarketByBaseSymbolAndKind(
        //     this.groupConfig,
        //     'BTC',
        //     'perp',
        // );
        // const ethPerpMarketConfig = getMarketByBaseSymbolAndKind(
        //     this.groupConfig,
        //     'ETH',
        //     'perp',
        // );

        // this.solMarketIndex = solPerpMarketConfig.marketIndex;
        // this.btcMarketIndex = btcPerpMarketConfig.marketIndex;
        // this.ethMarketIndex = ethPerpMarketConfig.marketIndex;
        // this.mangoGroup = await this.client.getMangoGroup(this.groupConfig.publicKey);

        // this.solPerpMarket = await this.mangoGroup.loadPerpMarket(
        //     this.connection,
        //     solPerpMarketConfig.marketIndex,
        //     solPerpMarketConfig.baseDecimals,
        //     solPerpMarketConfig.quoteDecimals,
        // );

        // this.btcPerpMarket = await this.mangoGroup.loadPerpMarket(
        //     this.connection,
        //     btcPerpMarketConfig.marketIndex,
        //     btcPerpMarketConfig.baseDecimals,
        //     btcPerpMarketConfig.quoteDecimals,
        // )
        // this.ethPerpMarket = await this.mangoGroup.loadPerpMarket(
        //     this.connection,
        //     ethPerpMarketConfig.marketIndex,
        //     ethPerpMarketConfig.baseDecimals,
        //     ethPerpMarketConfig.quoteDecimals,
        // )

        const mangoProgramId = groupIds.mangoProgramId;
        const client = new MangoClient(this.connection, mangoProgramId);
        const perpMarkets = await Promise.all(
            Object.keys(params.assets).map((baseSymbol) => {
                const perpMarketConfig = getPerpMarketByBaseSymbol(
                    groupIds,
                    baseSymbol,
                ) as PerpMarketConfig;

                return client.getPerpMarket(
                    perpMarketConfig.publicKey,
                    perpMarketConfig.baseDecimals,
                    perpMarketConfig.quoteDecimals,
                );
            }),
        );


        this.owner = new Account(
            JSON.parse(
                fs.readFileSync(
                    process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json',
                    'utf-8',
                ),
            ),
        );
        const allAccounts = [
            group.mangoCache,
            oldMangoAccount.publicKey,
            ...inBasketOpenOrders,
            ...marketContexts.map((marketContext) => marketContext.market.bids),
            ...marketContexts.map((marketContext) => marketContext.market.asks),
        ];
        const accountInfos = await getMultipleAccounts(this.connection, allAccounts);
        this.mangoAccount = new MangoAccount(
            accountInfos[1].publicKey,
            MangoAccountLayout.decode(accountInfos[1].accountInfo.data),
        );

        this.mangoAccount = (
            await this.client.getMangoAccountsForOwner(this.mangoGroup, this.owner.publicKey)
        )[0];
    }

    /**
    * Load MangoCache, MangoAccount and Bids and Asks for all PerpMarkets using only
    * one RPC call.
    */
    async loadAccountAndMarketState(
        connection: Connection,
        group: MangoGroup,
        oldMangoAccount: MangoAccount,
        marketContexts: MarketContext[],
    ): Promise<State> {
        const inBasketOpenOrders = oldMangoAccount
            .getOpenOrdersKeysInBasket()
            .filter((pk) => !pk.equals(zeroKey));

        const allAccounts = [
            group.mangoCache,
            oldMangoAccount.publicKey,
            ...inBasketOpenOrders,
            ...marketContexts.map((marketContext) => marketContext.market.bids),
            ...marketContexts.map((marketContext) => marketContext.market.asks),
        ];

        const ts = getUnixTs();
        const accountInfos = await getMultipleAccounts(connection, allAccounts);

        const cache = new MangoCache(
            accountInfos[0].publicKey,
            MangoCacheLayout.decode(accountInfos[0].accountInfo.data),
        );

        const mangoAccount = new MangoAccount(
            accountInfos[1].publicKey,
            MangoAccountLayout.decode(accountInfos[1].accountInfo.data),
        );
        const openOrdersAis = accountInfos.slice(2, 2 + inBasketOpenOrders.length);
        for (let i = 0; i < openOrdersAis.length; i++) {
            const ai = openOrdersAis[i];
            const marketIndex = mangoAccount.spotOpenOrders.findIndex((soo) =>
                soo.equals(ai.publicKey),
            );
            mangoAccount.spotOpenOrdersAccounts[marketIndex] =
                OpenOrders.fromAccountInfo(
                    ai.publicKey,
                    ai.accountInfo,
                    group.dexProgramId,
                );
        }

        accountInfos
            .slice(
                2 + inBasketOpenOrders.length,
                2 + inBasketOpenOrders.length + marketContexts.length,
            )
            .forEach((ai, i) => {
                marketContexts[i].bids = new BookSide(
                    ai.publicKey,
                    marketContexts[i].market,
                    BookSideLayout.decode(ai.accountInfo.data),
                );
            });

        accountInfos
            .slice(
                2 + inBasketOpenOrders.length + marketContexts.length,
                2 + inBasketOpenOrders.length + 2 * marketContexts.length,
            )
            .forEach((ai, i) => {
                marketContexts[i].lastBookUpdate = ts;
                marketContexts[i].asks = new BookSide(
                    ai.publicKey,
                    marketContexts[i].market,
                    BookSideLayout.decode(ai.accountInfo.data),
                );
            });

        return {
            cache,
            mangoAccount,
            lastMangoAccountUpdate: ts,
            marketContexts,
        };
    }

    async refresh() {
        this.mangoAccount = (
            await this.client.getMangoAccountsForOwner(this.mangoGroup, this.owner.publicKey)
        )[0];
    }


    async getTopBid() {
        let bids = await this.solPerpMarket.loadBids(this.connection);
        return bids.getL2(1)[0][0]
    }

    async getTopAsk() {
        let asks = await this.solPerpMarket.loadAsks(this.connection);
        return asks.getL2(1)[0][0]
    }

    async getPositions() {
        await this.refresh()

        const SOL = this.mangoAccount.getPerpPositionUi(this.solMarketIndex, this.solPerpMarket)
        const ETH = this.mangoAccount.getPerpPositionUi(this.ethMarketIndex, this.ethPerpMarket)
        const BTC = this.mangoAccount.getPerpPositionUi(this.btcMarketIndex, this.btcPerpMarket)
        return {
            SOL, ETH, BTC
        }
    }

    async getAccountValue() {
        let cache = await this.mangoGroup.loadCache(this.connection);

        const asset = (this.mangoAccount.getAssetsVal(this.mangoGroup, cache).toNumber())
        const liability = (this.mangoAccount.getLiabsVal(this.mangoGroup, cache).toNumber())
        return asset - liability
    }

    marketLong(usdAmount, topAsk, quantity) {
        const [nativePrice, nativeQuantity] = this.solPerpMarket.uiToNativePriceQuantity(
            topAsk,
            quantity,
        );

        return makePlacePerpOrderInstruction(
            this.client.programId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.owner.publicKey,
            this.mangoGroup.mangoCache,
            this.solPerpMarket.publicKey,
            this.solPerpMarket.bids,
            this.solPerpMarket.asks,
            this.solPerpMarket.eventQueue,
            this.mangoAccount.spotOpenOrders,
            nativePrice,
            nativeQuantity,
            new BN(Date.now()),
            'buy', // or 'sell'
            'market',
        )
    }

    marketShort(usdAmount, topBid, quantity) {
        const [nativePrice, nativeQuantity] = this.solPerpMarket.uiToNativePriceQuantity(
            topBid,
            quantity,
        );

        return makePlacePerpOrderInstruction(
            this.client.programId,
            this.mangoGroup.publicKey,
            this.mangoAccount.publicKey,
            this.owner.publicKey,
            this.mangoGroup.mangoCache,
            this.solPerpMarket.publicKey,
            this.solPerpMarket.bids,
            this.solPerpMarket.asks,
            this.solPerpMarket.eventQueue,
            this.mangoAccount.spotOpenOrders,
            nativePrice,
            nativeQuantity,
            new BN(Date.now()),
            'sell', // or 'sell'
            'market',
        )
    }
}

