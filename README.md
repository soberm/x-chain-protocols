# Cross-Blockchain Asset Transfer Protocols

This project contains Ethereum smart contracts enabling decentralized cross-blockchain asset transfers between EVM-based blockchains. The provided implementation allows users to transfer ERC-20 tokens from one blockchain to another in a completely decentralized way.
For that, the provided smart contracts need to be deployed on each participating blockchain.

> _Important: This project is a research prototype demonstrating the feasibility of cross-blockchain asset transfer protocols. Use it with care in production systems._

## Installation

In order to correctly clone this project with its submodules, supply the `--recurse-submodules` flag to the clone command.
If you have already cloned the repo, run `git submodule update --init --recursive`.

The following guide will walk you through the deployment of the provided smart contracts on a local blockchain (Ganache).

### Prerequisites

You need to have the following tools installed:

* [Node](https://nodejs.org/en/)
* [Ganache](https://www.trufflesuite.com/ganache) (>= 2.1.0)

### Deployment

1. Install all dependencies: `npm install`
2. Deploy contracts: `truffle migrate --reset`

### Testing

Run the tests with `truffle test`. Apart from conducting tests on a single blockchain, the directory `/evaluation` contains scripts for conducting asset transfers between two EVM-based blockchains, e.g., to send ERC-20 tokens from Rinkeby to Ropsten. For that, you have to provide the respective node URLs, your account addresses and the corresponding private keys in the file `/evaluation/config.json`. To deploy the contracts on both chains, run `truffle exec ./evaluation/deploy.js`. This will deploy the contracts on both blockchains and store their respective addresses in the file `/evaluation/config.json`. To conduct assets transfers, run `truffle exec ./evaluation/evaluation.js`.

### Transaction Inclusion Verification

The implemented concepts rely on a mechanism to verify within some blockchain whether a transaction has been included and confirmed by enough succeeding blocks on some other blockchains. This project does not provide such a mechanism, it merely provides an interface and a mock contract implementing the interface without conducting any inclusion verification. If you wish to run the implemenantion with some other mechanisms such as relays (e.g., the [Testimonium relay](https://github.com/pantos-io/testimonium)), please make sure that the corresponding smart contract implements the interfaces specified in `contracts/TxInclusionVerifier.sol`. The abi of the contract can be specified in the file `/evaluation/config.json` (see txVerifier.file). When calling the deploy script, this contract will be automatically deployed before the contracts implementing the transfer protocols.

## How to contribute

This project is a research prototype. We welcome anyone to contribute.
File a bug report or submit feature requests through the [issue tracker](https://github.com/pf92/x-chain-protocols/issues).
If you want to contribute feel free to submit a pull request.

## Licence

This project is licensed under the [MIT License](LICENSE).
