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
    web3.eth.handleRevert = true;

    for (const {privateKey} of Object.values(config.accounts)) {
        web3.eth.accounts.wallet.add(
            web3.eth.accounts.privateKeyToAccount(privateKey),
        );
    }

    const networkConfig = {
        web3,
        "contracts": {},
    };

    for (const [name, contract] of Object.entries(config.contracts)) {
        networkConfig.contracts[name] = getContractConfig(web3, contract);
    }

    return networkConfig;
}
