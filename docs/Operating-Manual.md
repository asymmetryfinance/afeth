# Operating Manual

This document documents how the protocol is meant to be interacted with and maintained. It's split
into two main sections: admin and user. "Admin" refers to any priviledged roles and "user" is any
permissionless actions that are accessible by anyone.

## Admin

> [!CAUTION]
> In case of an on-going exploit or other emergency invoke the `AfEth::emergencyShutdown()` method,
> this will pause all deposit/withdrawal functions as well as disable the votium strategy, note that
> this method may consume quite a bit of gas.

### Reward Claiming & Rebalancing

In the following steps `Votium` is short for the `VotiumStrategy` contract.

1. As the rewarder: Claim the rewards using the `Votium::claimRewards(IVotiumMerkleStash.ClaimParam[] claimProofs)` method
2. (One-time setup) As the owner: Grant allowances on behalf of the Votium contract to addresses
   you'd like to use to swap through by calling `Votium::grantAddedAllowances(Allowance[] allowances)`
3. As the rewarder: Swap the rewards using the `Votium::swapRewards(Swap[] swaps, uint256 cvxPerEthMin, uint256 sfrxPerEthMin, uint256 ethPerSfrxMin, uint256 deadline)` be sure to provide accurate values for `cvxPerEthMin`, `sfrxPerEthMin` and `ethPerSfrxMin` as they'll set the slippage for the rebalance / reward distribution callback.
4. (Additionally) As the rewarder / owner: Call `AfEth::depositRewardsAndRebalance(IAfEth.RebalanceParams params)` at set intervals to ensure the trickle unlocked rewards are swapped for CVX & sfrxETH and are available for actual withdrawal (Note: Not entirely necessary as `swapRewards` also triggers this).

### Managing the Quick Action Reserves

These calls are only available to the owner. Note that fees will accrue directly to the quick action
reserves. You can immediately withdraw them after triggering a rebalance / reward distribution via
`swapRewards` or `depositRewardsAndRebalance` to avoid this.

- Deposit afETH + ETH: `AfEth::depositForQuickActions(uint256 afEthAmount) payable`. Note you can
set `afEthAmount` to `1 << 255` to indicate you'd like to deposit the owner's entire afETH balance.
- Withdraw afETH + ETH: `AfEth::withdrawOwnerFunds(uint256 afEthAmount, uint256 ethAmount)`. Similar
  to the deposit for quick actions methods you can specify `1 << 255` for either input to indicate
  you'd like to withdraw everything.

### Who?

- Owner (`AfEth::owner()`, `Votium::owner()`): Is allow

### Configuring Roles

**Changing the owner (AfEth & Votium)**

1. The new owner needs to call `requestOwnershipHandover()` this will request a handover.
2. The current owner will then have 48h to call `completeOwnershipHandover(address newOwner)` to
   confirm the handover.

This process is recommended as it ensures you don't accidentally transfer ownership to a wallet you
don't have control over.

**Changing the rewarder (AfEth & Votium)**

As the owner call `setRewarder(address)` with the address of the new rewarder.

## User

### Depositing

#### Direct Deposits

Direct deposits are executable at any time but require interaction with the actual afETH deposit
mechanism incurring more gas vs. the cheaper "quick" category of actions.

**Function Signatures:**
- `deposit(uint256 minDepositValue, uint256 deadline) payable returns (uint256 shares)`
- `deposit(address to, uint256 minDepositValue, uint256 deadline) payable returns (uint256 shares)`

**Arguments:**
- `address to`: (optional) indicates the recipient of shares, useful for vaults or relayer type
  contracts that are minting onbehalf of 3rd parties (saves gas to not have to do a separate
  transfer)
- `uint256 minDepositValue`: The value of the underlying assets that the ETH is converted into
  (valued based on the prices reported by the underlying oracles, and the sfrxETH vault), serves as
  slippage protection.
- `uint256 deadline`: Timestamp after which the transaction will simply revert (useful to protect
  low gas transactions that may not be included immediately)

**Return Value:**
- `uint256 shares`: Amount of afETH minted in return for the deposited ETH.

#### "Quick" Deposits

The quick deposit methods allow the user to _trade against_ liquidity provided by the owner for
a cheaper method of depositing. For the deposit the currently reported vault price (`AfEth::price()`)
is given minus the action fee (`AfEth::quickDepositFeeBps()`). **Fees stay in the pool's active liquidity**.
There is also a per-transaction quick deposit limit indicated by `AfEth::maxSingleQuickDeposit()`.

**Function Signatures:**
- `quickDeposit(uint256 minOut, uint256 deadline) payable returns (uint256 afEthOut)`
- `quickDeposit(address to, uint256 minOut, uint256 deadline) payable returns (uint256 afEthOut)`

**Arguments:**
- `address to`: (optional) indicates the recipient of shares, useful for vaults or relayer type
  contracts that are minting onbehalf of 3rd parties (saves gas to not have to do a separate
  transfer)
- `uint256 minOut`: The minimum shares (afETH) to receive in exchange for the ETH, serves as
  slippage and fee rug protection.
- `uint256 deadline`: Timestamp after which the transaction will simply revert (useful to protect
  low gas transactions that may not be included immediately)

**Return Value:**
- `uint256 afEthOut`: The amount of afETH actually returned by the function (will be at least
  `minOut`).

### Withdrawing

#### Direct Withdrawals

Direct withdrawals involves burning afETH in-exchange for ETH. This is achieved by redeeming and
swapping the underlying assets. Due to the nature of the underyling Votium strategy that handles the
CVX part of the vault, assets may not be withdrawable immediately but is instead queued up for a later
time.

**Step 1. (initial withdrawal request)**

The first step in a direct withdrawal is calling the `AfEth::requestWithdraw` function. It takes the
following parameters (in the order specified):

- `uint256 amount`: The amount of afETH to be burnt and redeemd from the caller.
- `uint256 minOutOnlySfrx`: The minimum amount of ETH to receive if only the value from the sfrxETH
  managing strategy is immediately withdrawable, serves as slippage protection.
- `uint256 minOutAll`: The minimum amount of ETH to receive if the entire value is immediately
  withdrawable, also serves as slippage protection in the alternative case.
- `uint256 deadline`: The timestamp after which the withdrawal transaction will simply revert.

Furthermore the top-level `AfEth::requestWithdraw` function has the following return values:
- `uint256 totalEthOut`: The ETH immediately received from the withdrawal (will not include any
  additional value that is pending in the queue).
- `bool locked`: Whether there's remaining value that's still locked (`true`: locked, `false`: all
  was immediately withdrawn)
- `uint256 cumulativeUnlockThreshold`: If locked the "threshold" parameter at which the value will
  be unlockable (0 if nothing is locked).

**Step 2. (completing the withdrawal)**

The second step is only necessary if some funds remain locked, indicated by the
`AfEth::requestWithdraw` method returning `true` for its `locked` return value.

Once there is sufficient free CVX to meet all pending withdrawals up to the waiting users withdrawal
a user can withdraw their final share of value directly from the votium strategy contract. This is
the only interaction in the entire system where users are interacting with any contract besides
afETH. To execute their unlocked withdrawal from the votium strategy they must call the
`VotiumStrategy::withdrawLocked` method.

With arguments (in order):
- `uint256 cumulativeUnlockThreshold`: The unlock threshold parameter initially returned from the
  call to `AfEth::requestWithdraw`.
- `uint256 minOut`: The minimum ETH to receive when swapping the unlocked CVX for ETH.
> [!IMPORTANT]
> Exactly `0` can be specified to indicate that the underlyling CVX itself should be withdrawn
> intsead of swapping it for ETH, in this case slippage doesn't matter as no swaps are occuring.
- `uint256 deadline`: The timestamp after which the transaction reverts.

Return value:
- `uint256 ethReceived`: ETH received from the withdrawal, 0 if the direct CVX withdrawal option is
  chosen.

#### "Quick" Withdrawals

Similar to deposits the AfEth contract has "quick" withdrawal methods that allows afETH to directly
be swapped for ETH by trading against the owner. afETH is redeemed at the price inidicated by
afETH's `AfEth::price()` minus the quick withdrawal fee (`AfEtH::quickWithdrawFeeBps()`).

**Function Signatures:**
- `quickWithdraw(uint256 amount, uint256 minOut, uint256 deadline) returns (uint256 ethOut)`
- `quickWithdraw(address to, uint256 amount, uint256 minOut, uint256 deadline) returns (uint256 ethOut)`

**Arguments:**
- `address to`: (optional) indicates the recipient of ETH, useful for vaults or relayer type
  contracts that are minting onbehalf of 3rd parties (saves gas to not have to do a separate
  transfer)
- `uint256 amount`: The amount of afETH to be redeemed / swapped from the caller.
- `uint256 minOut`: The minimum ETH to receive in exchange for the afETH, serves as
  slippage and fee rug protection.
- `uint256 deadline`: Timestamp after which the transaction will simply revert (useful to protect
  low gas transactions that may not be included immediately)

**Return Value:**
- `uint256 ethOut`: The amount of ETH actually returned by the function (will be at least
  `minOut`).
