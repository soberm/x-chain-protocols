const fs = require("fs");
const path = require("path");
const Web3 = require("web3");

function getContractConfig(web3, config) {
    const parsedJson = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, "../", config.file),
    ));

    const instance = new web3.eth.Contract(parsedJson.abi);
    if (typeof config.address !== "undefined") {
        instance.options.address = config.address;
    }

    return {
        "name": config.file.substring(
            config.file.lastIndexOf("/") + 1,
            config.file.lastIndexOf(".")
        ),
        "bytecode": parsedJson.bytecode,
        instance,
    };
}

module.exports = config => {
    const web3 = new Web3(new Web3.providers.WebsocketProvider(config.url));
    web3.eth.transactionBlockTimeout = 350;

    for (const {privateKey} of Object.values(config.accounts)) {
        web3.eth.accounts.wallet.add(
            web3.eth.accounts.privateKeyToAccount(privateKey),
        );
    }

    const networkConfig = {
        web3,
        "contracts": {},
        "name": config.name,
        "chainId": config.chainId,
        "accounts": config.accounts,
        "confirmations": config.confirmations,
    };

    for (const [name, contract] of Object.entries(config.contracts)) {
        networkConfig.contracts[name] = getContractConfig(web3, contract);
    }

    return networkConfig;
}
