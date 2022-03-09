const {
    asyncTriePut,
    newTrie,
    createRLPHeader,
    createRLPTransaction,
    createRLPReceipt,
    encodeToBuffer
} = require("../../utils");
const {BaseTrie: Trie} = require("merkle-patricia-tree");
const fs = require("fs");
const {
    callContract,
    sleep,
} = require("../common");
const config = require("./config");
const initNetwork = require("./network");

const RUNS = 300;

const network0Instance = initNetwork(config[0]);
const network1Instance = initNetwork(config[1]);

(async function startEvaluation() {

    console.log("+++ Starting evaluation +++");

    const fd = fs.openSync("./results.csv", "w");
    fs.writeSync(fd, "run,burn_gas,claim_gas,confirm_gas,burn_cost,claim_cost,confirm_cost,burn_incTime,claim_incTime,confirm_incTime,burn_confTime,claim_confTime,confirm_confTime,burn_confTimeRelay,claim_confTimeRelay\n");

    const [config0, config1] = [config[0], config[1]];

    for (let run = 1; run <= RUNS; run++) {
        let result = {
            burn: {},
            claim: {},
            confirm: {}
        };
        console.log("Run:", run);

        // submit burn transaction
        let balanceInWeiBefore = BigInt(await network0Instance.web3.eth.getBalance(config0.accounts.user.address));
        let startTime = new Date().getTime();
        let burnReceipt;
        try {
            burnReceipt = await burn(config0, network0Instance, config1.accounts.user.address, config1.contracts.protocol.address, 1, 0);
        } catch (e) {
            console.log(e.message);
            run--;
            continue;
        }
        
        let endTime = new Date().getTime();
        let balanceInWeiAfter = BigInt(await network0Instance.web3.eth.getBalance(config0.accounts.user.address));
        result.burn.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.burn.gasConsumption = burnReceipt.gasUsed;
        result.burn.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log("wait for confirmation of burn tx...");
        startTime = new Date().getTime();
        await waitUntilConfirmed(network0Instance.web3, burnReceipt.transactionHash, config0.confirmations);
        endTime = new Date().getTime();
        result.burn.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("burn tx is confirmed");

        console.log("wait for burn tx to be confirmed within oracle running on Ropsten...");
        startTime = new Date().getTime();
        await waitUntilConfirmedWithinOracle(config1, network1Instance, burnReceipt.blockHash, network1Instance.contracts.oracle.instance);
        endTime = new Date().getTime();
        result.burn.relayTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("burn tx is confirmed within oracle");

        // submit claim transaction
        burnReceipt = await network0Instance.web3.eth.getTransactionReceipt(burnReceipt.transactionHash);  // load receipt again to be on the safe side if chain reorganization occurred

        let [block, tx, txReceipt] = await Promise.all([
            network0Instance.web3.eth.getBlock(burnReceipt.blockHash),
            network0Instance.web3.eth.getTransaction(burnReceipt.transactionHash),
            network0Instance.web3.eth.getTransactionReceipt(burnReceipt.transactionHash),
        ]);
        let rlpHeader = createRLPHeader(block);
        let serializedTx = createRLPTransaction(tx, config0.chainId);
        let serializedReceipt = createRLPReceipt(txReceipt);
        let path = encodeToBuffer(tx.transactionIndex);
        let rlpEncodedTxNodes = await createTxMerkleProof(network0Instance.web3, config0.chainId, block, tx.transactionIndex);
        let rlpEncodedReceiptNodes = await createReceiptMerkleProof(network0Instance.web3, block, tx.transactionIndex);

        balanceInWeiBefore = BigInt(await network1Instance.web3.eth.getBalance(config1.accounts.user.address));
        startTime = new Date().getTime();
        let claimReceipt;

        try {
            claimReceipt = await claim(config1, network1Instance, rlpHeader, serializedTx, serializedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        } catch(e) {
            console.log(e.message);
            run--;
            continue;
        }
        endTime = new Date().getTime();
        balanceInWeiAfter = BigInt(await network1Instance.web3.eth.getBalance(config1.accounts.user.address));
        result.claim.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.claim.gasConsumption = claimReceipt.gasUsed;
        result.claim.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log("wait for confirmation of claim tx...");
        startTime = new Date().getTime();
        await waitUntilConfirmed(network1Instance.web3, claimReceipt.transactionHash, config1.confirmations);
        endTime = new Date().getTime();
        result.claim.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("claim tx is confirmed");

        console.log("wait for claim tx to be confirmed within oracle running on Rinkeby...");
        startTime = new Date().getTime();
        await waitUntilConfirmedWithinOracle(config0, network0Instance, claimReceipt.blockHash, network0Instance.contracts.oracle.instance);
        endTime = new Date().getTime();
        result.claim.relayTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("claim tx is confirmed within relay");

        // submit confirm transaction
        claimReceipt = await network1Instance.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);  // load receipt again to be on the safe side if chain reorganization occurred
        block = await network1Instance.web3.eth.getBlock(claimReceipt.blockHash);
        tx = await network1Instance.web3.eth.getTransaction(claimReceipt.transactionHash);
        txReceipt = await network1Instance.web3.eth.getTransactionReceipt(claimReceipt.transactionHash);
        rlpHeader = createRLPHeader(block);
        serializedTx = createRLPTransaction(tx, config1.chainId);
        serializedReceipt = createRLPReceipt(txReceipt);
        path = encodeToBuffer(tx.transactionIndex);
        rlpEncodedTxNodes = await createTxMerkleProof(network1Instance.web3, config1.chainId, block, tx.transactionIndex);
        rlpEncodedReceiptNodes = await createReceiptMerkleProof(network1Instance.web3, block, tx.transactionIndex);

        balanceInWeiBefore = BigInt(await network0Instance.web3.eth.getBalance(config0.accounts.user.address));
        startTime = new Date().getTime();
        let confirmReceipt;
        try {
            confirmReceipt = await confirm(config0, network0Instance, rlpHeader, serializedTx, serializedReceipt, rlpEncodedTxNodes, rlpEncodedReceiptNodes, path);
        } catch (e) {
            console.log(e.message);
            run--;
            continue;
        }
        endTime = new Date().getTime();
        balanceInWeiAfter = BigInt(await network0Instance.web3.eth.getBalance(config0.accounts.user.address));
        result.confirm.inclusionTime = (endTime - startTime) / 1000;  // diff in seconds
        result.confirm.gasConsumption = confirmReceipt.gasUsed;
        result.confirm.cost = balanceInWeiBefore - balanceInWeiAfter;

        console.log("wait for confirmation of confirm tx...");
        startTime = new Date().getTime();
        await waitUntilConfirmed(network0Instance.web3, confirmReceipt.transactionHash, config0.confirmations);
        endTime = new Date().getTime();
        result.confirm.confirmationTime = (endTime - startTime) / 1000;  // diff in seconds
        console.log("confirm tx is confirmed");

        console.log(`${run}: ${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.cost},${result.claim.cost},${result.confirm.cost},${result.burn.inclusionTime},${result.claim.inclusionTime},${result.confirm.inclusionTime},${result.burn.confirmationTime},${result.claim.confirmationTime},${result.confirm.confirmationTime},${result.burn.relayTime},${result.claim.relayTime}`);
        fs.writeSync(fd, `${run},${result.burn.gasConsumption},${result.claim.gasConsumption},${result.confirm.gasConsumption},${result.burn.cost},${result.claim.cost},${result.confirm.cost},${result.burn.inclusionTime},${result.claim.inclusionTime},${result.confirm.inclusionTime},${result.burn.confirmationTime},${result.claim.confirmationTime},${result.confirm.confirmationTime},${result.burn.relayTime},${result.claim.relayTime}\n`);
    }

    fs.closeSync(fd);
    console.log("+++ Done +++");
})();

async function burn(jsonConfig, networkInstance, recipientAddr, claimContractAddr, value, stake) {
    return await callContract(
        jsonConfig.name,
        networkInstance.contracts.protocol.instance.methods.burn(recipientAddr, claimContractAddr, value, stake),
        jsonConfig.accounts.user.address,
    );
}

async function claim(jsonConfig, networkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return await callContract(
        jsonConfig.name,
        networkInstance.contracts.protocol.instance.methods.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path),
        jsonConfig.accounts.user.address,
    );
}

async function confirm(jsonConfig, networkInstance, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return await callContract(
        jsonConfig.name,
        networkInstance.contracts.protocol.instance.methods.confirm(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path),
        jsonConfig.accounts.user.address,
    );
}

async function waitUntilConfirmed(web3, txHash, confirmations) {
    while (true) {
        let receipt = await web3.eth.getTransactionReceipt(txHash);
        if (receipt !== null) {
            let mostRecentBlockNumber = await web3.eth.getBlockNumber();
            if (receipt.blockNumber + confirmations <= mostRecentBlockNumber) {
                // receipt != null -> tx is part of main chain
                // and block containing tx has at least confirmations successors
                break;
            }
        }
        await sleep(1500);
    }
}

async function waitUntilConfirmedWithinOracle(jsonConfig, networkConfig, blockHash, oracleContract) {

    const promise = new Promise((resolve, reject) => {
        oracleContract.once("ValidationResponse", {
            "filter": {
                "typ": 1,
                "hash": blockHash,
            },
        }, (err, event) => {
            if (err != null) {
                reject(err);
                return;
            }

            if (!event.returnValues.valid) {
                reject(new Error("transaction is not valid"))
                return;
            }

            resolve();
        });
    });

    await callContract(
        jsonConfig.name,
        networkConfig.contracts.oracle.instance.methods.validateBlock(blockHash),
        jsonConfig.accounts.user.address,
    );

    return promise;
}

const createTxMerkleProof = async (web3, chainId, block, transactionIndex) => {
    const trie = newTrie();
    for (let i = 0; i < block.transactions.length; i++) {
        const tx = await web3.eth.getTransaction(block.transactions[i]);
        const rlpTx = createRLPTransaction(tx, chainId);
        const key = encodeToBuffer(i);

        await asyncTriePut(trie, key, rlpTx);
    }

    const key = encodeToBuffer(transactionIndex);
    return encodeToBuffer(await Trie.createProof(trie, key));
};

const createReceiptMerkleProof = async (web3, block, transactionIndex) => {
    const trie = newTrie();

    for (let i = 0; i < block.transactions.length; i++) {
        const receipt = await web3.eth.getTransactionReceipt(block.transactions[i]);
        const rlpReceipt = createRLPReceipt(receipt);
        const key = encodeToBuffer(i);
        
        await asyncTriePut(trie, key, rlpReceipt);
    }

    const key = encodeToBuffer(transactionIndex);
    return encodeToBuffer(await Trie.createProof(trie, key));
};
