const fs = require("fs");
const path = require("path");

async function callContract(name, method, from, confirmations) {

    console.log(`Calling method ${method._method.name} on ${name}`);

    const tx = method.send({
        /*
         * Add a buffer for changes made by transactions that are executed before this transaction but after
         * gas estimation has taken place (e.g. a submitBlock of ETH Relay changes gas costs of a claim transaction)
         */
        "gas": Math.floor(1.3 * (await method.estimateGas({from}))),
        from,
    });

    const inclusionPromise = tx.then(receipt => {
        console.log(`New transaction on ${name} with hash ${receipt.transactionHash}`);
        return receipt;
    });

    if (typeof confirmations === "number") {
        return {
            "inclusion": inclusionPromise,
            "confirmation": new Promise((resolve, reject) => {
                tx
                    .once("error", reject)
                    .on("confirmation", (confNumber, receipt) => {
                        if (confNumber === confirmations) {
                            resolve(receipt);
                            tx.off("confirmation");
                        }
                    })
            }),
        };
    }

    return inclusionPromise;
};

async function deployContract(jsonConfig, contract, constructorArguments) {
    console.log(`Deploying contract ${contract.name} on ${jsonConfig.name}...`);

    const from = jsonConfig.accounts.user.address;
    contract.instance.options.from = from;

    const tx = contract.instance.deploy({
        data: contract.bytecode,
        arguments: constructorArguments,
    });

    const address = (await tx.send({
        "gas": await tx.estimateGas({from}),
        from,
    })).options.address;

    contract.instance.options.address = address;
    
    console.log(`Contract ${contract.name} deployed at ${address} on ${jsonConfig.name}`);

    return address;
}

function updateConfigJson(config, dirname) {
    const jsonString = JSON.stringify(config, null, 2);
    fs.writeFileSync(path.resolve(dirname, "config.json"), jsonString);
}

async function registerTokenContract(networkName, networkInstance, contractAddrToRegister, from) {
    return await callContract(
        networkName,
        networkInstance.contracts.protocol.instance.methods.registerTokenContract(contractAddrToRegister),
        from,
    );
}

function sleep(ms) {
    return new Promise(resolve => { setTimeout(resolve, ms); });
};

function burn(networkFrom, networkTo) {
    return callContract(
        networkFrom.name,
        networkFrom.contracts.protocol.instance.methods.burn(
            networkTo.accounts.user.address,
            networkTo.contracts.protocol.instance.options.address,
            1,
            0,
        ),
        networkFrom.accounts.user.address,
        networkFrom.confirmations,
    );
}

function claim(network, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return callContract(
        network.name,
        network.contracts.protocol.instance.methods.claim(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path),
        network.accounts.user.address,
        network.confirmations,
    );
}

function confirm(network, rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path) {
    return callContract(
        network.name,
        network.contracts.protocol.instance.methods.confirm(rlpHeader, rlpEncodedTx, rlpEncodedReceipt, rlpMerkleProofTx, rlpMerkleProofReceipt, path),
        network.accounts.user.address,
        network.confirmations,
    );
}

module.exports = {
    callContract,
    deployContract,
    updateConfigJson,
    registerTokenContract,
    sleep,
    burn,
    claim,
    confirm,
};