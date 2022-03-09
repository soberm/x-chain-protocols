const fs = require("fs");
const Web3 = require("web3");

function getContractConfig(web3, config) {
    const parsedJson = JSON.parse(fs.readFileSync(config.file));
    const bytecode = parsedJson.bytecode;
    const instance = new web3.eth.Contract(parsedJson.abi);
    if (typeof config.address !== "undefined" && config.address !== "") {
        instance.options.address = config.address;
    }
    const name = config.file.substring(
        config.file.lastIndexOf("/") + 1,
        config.file.lastIndexOf(".")
    );

    return {
        name,
        bytecode,
        instance,
    };
}

module.exports = config => {
    const web3 = new Web3(new Web3.providers.WebsocketProvider(config.url));
    web3.eth.transactionBlockTimeout = 350;

    // Creating a signing account from a private key
    const signer = web3.eth.accounts.privateKeyToAccount(
        config.accounts.user.privateKey,
    );
    web3.eth.accounts.wallet.add(signer);

    const networkConfig = {
        web3,
        "contracts": {},
    };

    for (const contract of [
        "distKey",
        "registry",
        "oracle",
        "protocol"
    ]) {
        networkConfig.contracts[contract] = getContractConfig(web3, config.contracts[contract]);
    }

    return networkConfig;
}
