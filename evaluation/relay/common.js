function getMostRecentBlockHash(relayContract, from)  {
    return relayContract.instance.methods.getLongestChainEndpoint().call({from});
};

module.exports = {
    getMostRecentBlockHash,
}
