# [AfEth Strategy Managers](https://www.asymmetry.finance/) • ![solidity](https://img.shields.io/badge/solidity-0.8.19-lightgrey)

## About

AfEth is an ERC20 token collerateralized by 2 underlying tokens in an adjustable ratio:

### Token 1, safEth:

https://etherscan.io/token/0x6732efaf6f39926346bef8b821a04b6361c4f3e5

Safeth is our liquid staking token consisting of 6 underling lsds (Lido, rocketpool, frax, etc...). It is a simple "price go up" token with significant immediate liquidity via its "stake" and "unstake" functions.

### Token 2, votium strategy token :

This is the where most of the complexity in afEth lives.

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
