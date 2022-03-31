const {callContract} = require("../common");

require("../runner")(__dirname, waitUntilConfirmedWithinOracle);

async function waitUntilConfirmedWithinOracle({"destination": network, receipt}) {

    const blockHash = receipt.blockHash;

    const promise = new Promise((resolve, reject) => {
        network.contracts.oracle.instance.once("ValidationResponse", {
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
        network.name,
        network.contracts.oracle.instance.methods.validateBlock(blockHash),
        network.accounts.user.address,
    );

    return promise;
}
