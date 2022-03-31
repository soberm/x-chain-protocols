require("../runner")(__dirname, waitUntilConfirmedWithinRelay);

async function waitUntilConfirmedWithinRelay({source, destination, receipt}) {
    const blockHash = (await source.web3.eth.getTransactionReceipt(receipt.transactionHash)).blockHash;

    return new Promise(resolve => {
        const subscription = destination.web3.eth.subscribe("newBlockHeaders", async err => {
            if (err !== null) {
               console.error(err);
               return;
            }

            const isConfirmed = await destination.contracts.relay.instance.methods.isBlockConfirmed(
                0,
                blockHash,
                source.confirmations,
            ).call();

            if (isConfirmed) {
                subscription.unsubscribe();
                resolve();
            }
        });
    });
}
