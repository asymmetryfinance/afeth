// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import {BaseTest} from "./utils/BaseTest.sol";
import {IAfEth} from "../src/interfaces/afeth/IAfEth.sol";
import {IVotiumStrategy} from "../src/interfaces/afeth/IVotiumStrategy.sol";
import {CvxEthOracleLib} from "../src/utils/CvxEthOracleLib.sol";
import {CVX} from "../src/interfaces/curve-convex/Constants.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {MockOracle} from "./mocks/MockOracle.sol";
import {CvxEthOracleLib} from "../src/utils/CvxEthOracleLib.sol";

import {console2 as console} from "forge-std/console2.sol";

/// @author philogy <https://github.com/philogy>
contract AfEthTest is BaseTest {
    using SafeTransferLib for address;

    function testFirstMint() public {
        address user = makeAddr("user");
        startHoax(user, 2 ether);

        uint256 preBal = afEth.balanceOf(user);
        uint256 amountOut = afEth.deposit{value: 2 ether}(0, block.timestamp);
        uint256 afterBal = afEth.balanceOf(user);

        vm.stopPrank();

        assertEq(afterBal - preBal, amountOut, "Did not reported afETH");

        assertApproxEqRel(
            afEth.totalEthValue(), amountOut, 0.0001e18, "total value not equal to amount of shares (within 1 bps)"
        );
    }

    function testMintedSharesOnDepositProportionalToValue() public {
        address user1 = makeAddr("user_1");
        uint256 amount1 = 2 ether;
        startHoax(user1, amount1);
        afEth.deposit{value: amount1}(0, block.timestamp);

        address user2 = makeAddr("user_2");
        uint256 amount2 = 1.829 ether;
        startHoax(user2, amount2);
        uint256 sharesOut = afEth.deposit{value: amount2}(0, block.timestamp);

        uint256 totalShares = afEth.totalSupply();
        uint256 totalValue = afEth.totalEthValue();

        assertApproxEqRel(
            sharesOut * 1e18 / totalShares,
            amount2 * 1e18 / totalValue,
            0.005e18,
            "ownership % in shares not approx. equal % share in contributed value"
        );
    }

    function testRevertsIfOutputBelowMin() public {
        address user = makeAddr("user");

        uint256 beforeDepositSnapshot = vm.snapshot();

        uint256 depositAmount = 1.3 ether;
        hoax(user, depositAmount);
        uint256 amountOut = afEth.deposit{value: depositAmount}(0, block.timestamp);

        vm.revertTo(beforeDepositSnapshot);

        vm.expectRevert(IAfEth.BelowMinOut.selector);
        hoax(user, depositAmount);
        afEth.deposit{value: depositAmount}(amountOut + 1, block.timestamp);
    }

    function testSimpleWithdrawLockedCvx() public {
        address user = makeAddr("user");
        uint256 value = 1.45 ether;
        hoax(user, value);
        uint256 amountOut = afEth.deposit{value: value}(0, block.timestamp);

        uint256 redeemAmount = amountOut / 3;

        vm.prank(user);
        uint256 balBefore = user.balance;
        (uint256 ethOut, bool locked, uint256 cumulativeUnlockThreshold) =
            afEth.requestWithdraw(redeemAmount, 0, 0, block.timestamp);
        uint256 ethReceived = user.balance - balBefore;
        assertEq(ethOut, ethReceived);

        assertTrue(locked);

        uint256 cvxLocked = votium.withdrawableAfterUnlocked(user, cumulativeUnlockThreshold);

        uint256 ethValue = CvxEthOracleLib.convertToEth(cvxLocked) + ethReceived;

        assertApproxEqRelDecimal(
            ethValue,
            value * redeemAmount / amountOut,
            0.005e18,
            18,
            "Received value not approx. staked value (within 0.5%)"
        );

        skip(20 weeks);

        uint256 cvxBefore = CVX.balanceOf(user);
        vm.prank(user);
        votium.withdrawLocked(cumulativeUnlockThreshold, 0, block.timestamp);
        uint256 cvxAfter = CVX.balanceOf(user);

        assertEq(cvxAfter - cvxBefore, cvxLocked);
    }

    function testRewardDistributionLocksReward() public {
        _deposit("user", 1.45 ether);

        uint256 reward = 31.98 ether;
        hoax(rewarder, reward);
        afEth.depositRewardsAndRebalance{value: reward}(IAfEth.RebalanceParams(0, 0, 0, block.timestamp));

        (uint256 sfrxRatio,,, uint256 unlocked, uint256 locked) = afEth.reportValue();

        assertApproxEqRelDecimal(sfrxRatio, 0.7e18, 0.005e18, 18, "sfrxETH:votium ratio not close to 70%");

        assertEq(locked, reward, "locked amount not equal to reward");
        assertEq(unlocked, 0, "default unlocked isn't 0");

        MockOracle cvxOracle = overwriteOracle(address(CvxEthOracleLib.CVX_ETH_ORACLE));

        skip(1.5 weeks);

        cvxOracle.update();

        assertEq(lockedRewards(), reward / 4, "Not exactly 3/4 of rewards unlocked of 3/4 of the time");
        cvxOracle.update(cvxOracle.price() * 88 / 100);

        uint256 addedLock = 3 ether;
        hoax(rewarder, addedLock);
        afEth.depositRewardsAndRebalance{value: addedLock}(IAfEth.RebalanceParams(0, 0, 0, block.timestamp));
        assertEq(lockedRewards(), reward / 4 + addedLock, "Extra amount not added to lock");
    }

    function testRewardDistributionAccruesFees() public {
        _deposit("user", 13.21 ether);

        vm.prank(owner);
        uint16 fee = 0.05e4;
        afEth.setProtocolFee(fee);

        uint256 reward = 4.2 ether;
        hoax(rewarder, reward);
        afEth.depositRewardsAndRebalance{value: reward}(IAfEth.RebalanceParams(0, 0, 0, block.timestamp));

        uint256 accruedFee = reward * fee / 1e4;
        assertEq(afEth.ethOwedToOwner(), accruedFee, "accrued fee not owed to owner");

        uint256 balanceBefore = owner.balance;
        vm.prank(owner);
        afEth.withdrawOwnerFunds(USE_MAX, USE_MAX);
        uint256 received = owner.balance - balanceBefore;
        assertEq(received, accruedFee);
    }

    function testQuickDeposit() public {
        uint256 totalAmount = 7 ether;
        uint256 convertAmount = 3 ether;
        uint256 ethAmount = totalAmount - convertAmount;

        startHoax(owner, totalAmount);
        uint256 sharesOut = afEth.deposit{value: convertAmount}(0, block.timestamp);
        uint16 depositFee = 0.01e4;
        afEth.configureQuickActions(depositFee, 0, type(uint128).max, type(uint128).max);
        afEth.depositForQuickActions{value: ethAmount}(1 << 248);
        vm.stopPrank();

        assertEq(afEth.ethOwedToOwner(), ethAmount, "eth owed to owner doesn't match deposited eth");
        assertEq(afEth.balanceOf(address(afEth)), sharesOut, "shares owned by vault don't match entire balance");

        uint256 price = afEth.price();
        address user = makeAddr("user");
        uint256 quickDepositAmount = 2 ether;
        hoax(user, quickDepositAmount);
        sharesOut = afEth.quickDeposit{value: quickDepositAmount}(0, block.timestamp);
        assertEq(ethAmount + quickDepositAmount, afEth.ethOwedToOwner());
        uint256 directShares = quickDepositAmount * 1e18 / price;
        directShares -= directShares * depositFee / 1e4;
        assertEq(sharesOut, directShares);
    }

    function testQuickWithdraw() public {
        uint256 totalAmount = 7 ether;
        uint256 convertAmount = 3 ether;
        uint256 ethAmount = totalAmount - convertAmount;

        startHoax(owner, totalAmount);
        uint256 sharesOut = afEth.deposit{value: convertAmount}(0, block.timestamp);
        uint16 withdrawFee = 0.0134e4;
        afEth.configureQuickActions(0, withdrawFee, type(uint128).max, type(uint128).max);
        afEth.depositForQuickActions{value: ethAmount}(1 << 248);
        vm.stopPrank();

        uint256 amount = 1.13 ether;
        address user = makeAddr("user");
        uint256 price = afEth.price();
        startHoax(user, amount);
        sharesOut = afEth.deposit{value: amount}(0, block.timestamp);

        uint256 sharesReservesBefore = afEth.balanceOf(address(afEth));
        uint256 ethBalBefore = user.balance;
        uint256 ethOut = afEth.quickWithdraw(sharesOut, 0, block.timestamp);
        uint256 expectedEthOut = sharesOut * price / 1e18;
        expectedEthOut -= expectedEthOut * withdrawFee / 1e4;
        assertEq(expectedEthOut, ethOut, "incorrect eth amount out");
        assertEq(user.balance, ethBalBefore + ethOut, "eth out not received");
        assertEq(afEth.balanceOf(address(afEth)), sharesReservesBefore + sharesOut, "held share sincorrect");
        assertEq(afEth.ethOwedToOwner(), ethAmount - ethOut, "eth owed to owner incorrect");
    }

    function testFullDepositCycle() public {
        address user = makeAddr("user");
        uint256 amount = 1.31 ether;
        startHoax(user, amount);
        uint256 sharesOut = afEth.deposit{value: amount}(0, block.timestamp);
        assertEq(afEth.balanceOf(user), sharesOut, "didn't receive shares");

        skip(30 weeks);

        (uint256 ethOut, bool locked, uint256 unlockThreshold) = afEth.requestWithdraw(sharesOut, 0, 0, block.timestamp);
        assertEq(afEth.balanceOf(user), 0, "shares weren't redeemed");
        assertFalse(locked, "locked");
        assertEq(unlockThreshold, 0, "not locked but threshold: 0");

        assertApproxEqRel(ethOut, amount, 0.005e18, "unlocked ETH not equal to amount");
    }

    function testOwnerCanUpgrade() public {
        address newImpl = makeAddr("new_impl");
        vm.etch(
            newImpl,
            hex"7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc3d52593d3d3560e01c6352d1902d0361003557f35bfd"
        );

        vm.prank(owner);
        afEth.upgradeToAndCall(newImpl, new bytes(0));

        (bool success, bytes memory errorData) = address(afEth).call(hex"01020304");
        assertFalse(success);
        assertEq(abi.decode(errorData, (bytes32)), 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc);
    }

    function testOnlyOwnerCanUpgrade() public {
        address newImpl = makeAddr("new_impl");
        vm.etch(
            newImpl,
            hex"7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc3d52593d3d3560e01c6352d1902d0361003557f35bfd"
        );

        vm.prank(owner);
        afEth.upgradeToAndCall(newImpl, new bytes(0));

        (bool success, bytes memory errorData) = address(afEth).call(hex"01020304");
        assertFalse(success);
        assertEq(abi.decode(errorData, (bytes32)), 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc);
    }

    function _deposit(string memory label, uint256 amount) internal returns (uint256 amountOut) {
        hoax(makeAddr(label), amount);
        amountOut = afEth.deposit{value: amount}(0, block.timestamp);
    }
}
