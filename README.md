# [AfEth Strategy Managers](https://www.asymmetry.finance/) • ![solidity](https://img.shields.io/badge/solidity-0.8.19-lightgrey)

## About

AfEth is an ERC20 token collerateralized by 2 underlying "strategy" tokens in an adjustable ratio. AfEth can be thought of as a "manager" that handles strategy tokens conforming to a common interface (see [AbstractErc20Strategy.sol](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/AbstractErc20Strategy.sol))

### Token 1, safEth strategy:

https://etherscan.io/token/0x6732efaf6f39926346bef8b821a04b6361c4f3e5

- safeth is our flagship liquid staking token consisting of 6 underling lsds (Lido, rocketpool, frax, etc...). It is a simple "price go up" token with immediate liquidity via its "stake" and "unstake" functions. 

- safEth strategy token is safEth with some small additions to make it fit [AbstractErc20Strategy.sol](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/AbstractErc20Strategy.sol).

### Token 2, votium strategy:

- The votium strategy utilizes [votium](https://votium.app/) incentives in the [convex finance](https://www.convexfinance.com/) ecosystem in order to make a token whos price only goes up in relation to the [convex token](https://etherscan.io/token/0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b).

- To mint votium strategy tokens, convex tokens are purchased, locked in the [vote locked convex cvx contract](https://etherscan.io/address/0x72a19342e8F1838460eBFCCEf09F6585e32db86E), and [delegated to votium][https://docs.votium.app/explainers/voter-manual], and afEth tokens are minted at the current [price](https://github.com/asymmetryfinance/afeth/blob/main/contracts/AfEth.sol#L129)

- Votium rewards are airdropped and able be claimed by our contract using the [claimRewards()](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/votiumErc20/VotiumErc20StrategyCore.sol#L192) function and merkle proofs [published by votium every 2 weeks](https://github.com/oo-00/Votium/tree/main/merkle). Reward sold via [applyRewards()](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/votiumErc20/VotiumErc20StrategyCore.sol#L272) sells rewards on 0x and put back into safEth & votium strategies, making the afEth price go up.


## Local Development

To use the correct node version run

```
nvm use
```

To install dependencies and compile run

```
yarn && yarn compile
```

## Testing

`yarn test` to run test suite.

Note integration tests for the votium strategy (VotiumIntegration.test.ts) are skipped by default so CI goes faster.
