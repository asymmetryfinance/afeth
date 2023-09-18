# [AfEth](https://www.asymmetry.finance/) • ![solidity](https://img.shields.io/badge/solidity-0.8.19-lightgrey)

## About

AfEth is an ERC20 token collerateralized by 2 underlying "strategy" tokens in an adjustable ratio. AfEth can be thought of as a "manager" that handles strategy tokens conforming to a common interface (see [AbstractErc20Strategy.sol](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/AbstractErc20Strategy.sol))

### Token 1, safEth strategy:

- [safeth](https://etherscan.io/token/0x6732efaf6f39926346bef8b821a04b6361c4f3e5) is our flagship liquid staking token consisting of 6 underling lsds ([Lido](https://lido.fi/), [rocketpool](https://rocketpool.net/), [staked frax](https://docs.frax.finance/frax-ether/overview), etc...). It is a simple "price go up" token with immediate liquidity via its "stake" and "unstake" functions. 

- safEth strategy token is safEth with some small additions to make it fit the common interface.

### Token 2, votium strategy:

- The votium strategy utilizes [votium](https://votium.app/) incentives in the [convex finance](https://www.convexfinance.com/) ecosystem in order to make a token whos price only goes up in relation to [convex token](https://etherscan.io/token/0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b)'s price (in eth).

- To mint votium strategy tokens, convex tokens are purchased, locked in the [vote locked cvx contract](https://etherscan.io/address/0x72a19342e8F1838460eBFCCEf09F6585e32db86E), and [delegated to votium](https://docs.votium.app/explainers/voter-manual), and strategy tokens are minted at the current strategy token price in votium  [cvxPerVotium()](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/votiumErc20/VotiumErc20StrategyCore.sol#L145C14-L145C26).

- Votium rewards are claimed with [claimRewards()](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/votiumErc20/VotiumErc20StrategyCore.sol#L192) using merkle proofs [published by votium](https://github.com/oo-00/Votium/tree/main/merkle) every 2 weeks. [applyRewards()](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/votiumErc20/VotiumErc20StrategyCore.sol#L272) sells rewards on 0x and deposits them back into afEth (and ultimately back into the safEth & votium strategies), making the afEth price go up.

- There is an unlock period to withdraw (up to 16 weeks) because votium strategy tokens are collateralized by many different vote locked convex positions. [requestWithdraw()](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/votiumErc20/VotiumErc20Strategy.sol#L54) burns the strategy tokens, calculates how much cvx they is owed based on cvxPerVotium() price, marks this amount to be unlocked on subsequent calls to [processExpiredLocks()](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/votiumErc20/VotiumErc20Strategy.sol#L145C39-L145C48), calculates unlock time and returns withdrawId to later be used in [withdraw()](https://github.com/asymmetryfinance/afeth/blob/main/contracts/strategies/votiumErc20/VotiumErc20Strategy.sol#L108).

### AfEth

- When minting, afEth purchases each underlying strategy token (safEth & votium) according to [ratio](https://github.com/asymmetryfinance/afeth/blob/main/contracts/AfEth.sol#L12).

- [depositRewards()](https://github.com/asymmetryfinance/afeth/blob/main/contracts/AfEth.sol#L306C14-L306C23) is used by the votium strategy (or anyone) upon claiming rewards to make the afEth price go up by distributing funds into both strategies according to ratio.

- `requestWithdraw()` must be called before withdrawing and will calculate how much time must pass before `withdraw()` can be called

### A note about varying unlock times

- When a user calls requestWithdraw() the contract
looks at who has requested to withdraw before them, calculates the date at which enough vlcvx can be unlocked to close their position along with everyone in front of them, and marks that amount of convex to be unlocked asap.

- Because of this, the withdraw time will be contantly changing for users that havent called requestWithdraw(). This could cause users to "race" to enter the unlock queue under certain unqiue market conditions.

- While this isnt ideal, we do not believe it to be exploitable in a harmful way because the maximum unlock time is 16 weeks regardless of state of the unlock queue.


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

`*Note``: *ntegration tests for the votium strategy ([VotiumIntegration.test.ts](https://github.com/asymmetryfinance/afeth/blob/main/test/strategies/VotiumErc20/VotiumIntegration.test.ts)) are skipped by default for faster CI

## Architecture Diagrams

Coming soon