// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Test} from "forge-std/Test.sol";

import {Ownable} from "solady/src/auth/Ownable.sol";

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IAfEth} from "../src/interfaces/afeth/IAfEth.sol";
import {CVX} from "../src/interfaces/curve-convex/Constants.sol";

import {CvxEthOracleLib} from "../src/utils/CvxEthOracleLib.sol";

import {VotiumStrategy} from "../src/strategies/VotiumStrategy.sol";

import {AfEthV2} from "../src/AfEthV2.sol";

contract AfEthV2Test is Test {

    address internal immutable OWNER = Ownable(PROXY).owner();
    address internal immutable REWARDER = AFETHV2_PROXY.rewarder();

    address private newImplementation;

    address private constant OLD_IMPLEMENTATION = address(0x0A36224486D4E49dEB27b489233c6B64e0241D6A);
    address private constant PROXY = address(0x0000000016E6Cb3038203c1129c8B4aEE7af7a11);
    address private constant VOTIUM_PROXY = address(0x00000069aBbB0B1Ad6975bcF753eEe15D318A0BF);

    AfEthV2 private constant AFETHV2_PROXY = AfEthV2(payable(PROXY));

    function setUp() public {
        newImplementation = address(new AfEthV2(VOTIUM_PROXY));
    }

    // ------------------------------------------------------------
    // Test Functions
    // ------------------------------------------------------------

    function testVariables() public {
        // set before variables
        address _rewarder = AFETHV2_PROXY.rewarder();
        uint16 _protocolFeeBps = AFETHV2_PROXY.protocolFeeBps();
        uint16 _sfrxStrategyShareBps = AFETHV2_PROXY.sfrxStrategyShareBps();
        bool _paused = AFETHV2_PROXY.paused();
        uint128 _maxSingleQuickDeposit = AFETHV2_PROXY.maxSingleQuickDeposit();
        uint16 _quickDepositFeeBps = AFETHV2_PROXY.quickDepositFeeBps();
        uint128 _maxSingleQuickWithdraw = AFETHV2_PROXY.maxSingleQuickWithdraw();
        uint16 _quickWithdrawFeeBps = AFETHV2_PROXY.quickWithdrawFeeBps();
        uint8 _decimals = AFETHV2_PROXY.decimals();
        uint256 _totalSupply = AFETHV2_PROXY.totalSupply();
        uint256 _totalEthValue = AFETHV2_PROXY.totalEthValue();
        uint256 _ethOwedToOwner = AFETHV2_PROXY.ethOwedToOwner();
        uint256 _price = AFETHV2_PROXY.price();

        // upgrade implementation
        _upgradeImplementation();

        // check after variables
        assertEq(AFETHV2_PROXY.rewarder(), _rewarder, "testVariables: E0");
        assertEq(AFETHV2_PROXY.protocolFeeBps(), _protocolFeeBps, "testVariables: E1");
        assertEq(AFETHV2_PROXY.sfrxStrategyShareBps(), _sfrxStrategyShareBps, "testVariables: E2");
        assertEq(AFETHV2_PROXY.paused(), _paused, "testVariables: E3");
        assertEq(AFETHV2_PROXY.maxSingleQuickDeposit(), _maxSingleQuickDeposit, "testVariables: E4");
        assertEq(AFETHV2_PROXY.quickDepositFeeBps(), _quickDepositFeeBps, "testVariables: E5");
        assertEq(AFETHV2_PROXY.maxSingleQuickWithdraw(), _maxSingleQuickWithdraw, "testVariables: E6");
        assertEq(AFETHV2_PROXY.quickWithdrawFeeBps(), _quickWithdrawFeeBps, "testVariables: E7");
        assertEq(AFETHV2_PROXY.decimals(), _decimals, "testVariables: E8");
        assertEq(AFETHV2_PROXY.totalSupply(), _totalSupply, "testVariables: E9");
        assertEq(AFETHV2_PROXY.totalEthValue(), _totalEthValue, "testVariables: E10");
        assertEq(AFETHV2_PROXY.symbol(), "afETH", "testVariables: E11");
        assertEq(AFETHV2_PROXY.name(), "Asymmetry Finance afETH", "testVariables: E12");
        assertEq(AFETHV2_PROXY.ethOwedToOwner(), _ethOwedToOwner, "testVariables: E13");
        assertEq(AFETHV2_PROXY.price(), _price, "testVariables: E14");
    }

    function testOwnerFunctions() public {

        // upgrade implementation
        _upgradeImplementation();

        vm.startPrank(OWNER);

        AFETHV2_PROXY.setRewarder(REWARDER);
        assertEq(AFETHV2_PROXY.rewarder(), REWARDER, "testOwnerFunctions: E0");

        uint256 _BPS = 1000;

        AFETHV2_PROXY.setSfrxEthStrategyShare(uint16(_BPS));
        assertEq(AFETHV2_PROXY.sfrxStrategyShareBps(), _BPS, "testOwnerFunctions: E1");

        AFETHV2_PROXY.setProtocolFee(uint16(_BPS));
        assertEq(AFETHV2_PROXY.protocolFeeBps(), _BPS, "testOwnerFunctions: E2");

        AFETHV2_PROXY.configureQuickActions(uint16(_BPS), uint16(_BPS), uint128(_BPS), uint128(_BPS));
        assertEq(AFETHV2_PROXY.quickDepositFeeBps(), _BPS, "testOwnerFunctions: E3");
        assertEq(AFETHV2_PROXY.maxSingleQuickDeposit(), _BPS, "testOwnerFunctions: E4");
        assertEq(AFETHV2_PROXY.quickWithdrawFeeBps(), _BPS, "testOwnerFunctions: E5");
        assertEq(AFETHV2_PROXY.maxSingleQuickWithdraw(), _BPS, "testOwnerFunctions: E6");

        AFETHV2_PROXY.emergencyShutdown();
        assertTrue(AFETHV2_PROXY.paused(), "testOwnerFunctions: E7");

        vm.stopPrank();

        // make sure only owner can call
        vm.startPrank(makeAddr("NOT_OWNER"));

        vm.expectRevert(bytes4(keccak256("Unauthorized()")));
        AFETHV2_PROXY.setRewarder(REWARDER);

        vm.expectRevert(bytes4(keccak256("Unauthorized()")));
        AFETHV2_PROXY.setSfrxEthStrategyShare(uint16(_BPS));

        vm.expectRevert(bytes4(keccak256("Unauthorized()")));
        AFETHV2_PROXY.setProtocolFee(uint16(_BPS));

        vm.expectRevert(bytes4(keccak256("Unauthorized()")));
        AFETHV2_PROXY.configureQuickActions(uint16(_BPS), uint16(_BPS), uint128(_BPS), uint128(_BPS));

        vm.stopPrank();
    }

    // tests from AfEth.t.sol

    function testMintedSharesOnDepositProportionalToValue() public {

        // upgrade implementation
        _upgradeImplementation();

        address user1 = makeAddr("user_1");
        uint256 amount1 = 2 ether;
        startHoax(user1, amount1);
        AFETHV2_PROXY.deposit{value: amount1}(0, block.timestamp);

        address user2 = makeAddr("user_2");
        uint256 amount2 = 1.829 ether;
        startHoax(user2, amount2);
        uint256 sharesOut = AFETHV2_PROXY.deposit{value: amount2}(0, block.timestamp);

        uint256 totalShares = AFETHV2_PROXY.totalSupply();
        uint256 totalValue = AFETHV2_PROXY.totalEthValue();

        assertApproxEqRel(
            sharesOut * 1e18 / totalShares,
            amount2 * 1e18 / totalValue,
            0.005e18,
            "ownership % in shares not approx. equal % share in contributed value"
        );
    }

    function testRevertsIfOutputBelowMin() public {

        // upgrade implementation
        _upgradeImplementation();

        address user = makeAddr("user");

        uint256 beforeDepositSnapshot = vm.snapshot();

        uint256 depositAmount = 1.3 ether;
        hoax(user, depositAmount);
        uint256 amountOut = AFETHV2_PROXY.deposit{value: depositAmount}(0, block.timestamp);

        vm.revertTo(beforeDepositSnapshot);

        vm.expectRevert(bytes4(keccak256("BelowMinOut()")));
        hoax(user, depositAmount);
        AFETHV2_PROXY.deposit{value: depositAmount}(amountOut + 1, block.timestamp);
    }

    function testSimpleWithdrawLockedCvx() public {

        // upgrade implementation
        _upgradeImplementation();

        address user = makeAddr("user");
        uint256 value = 1.45 ether;
        hoax(user, value);
        uint256 amountOut = AFETHV2_PROXY.deposit{value: value}(0, block.timestamp);

        uint256 redeemAmount = amountOut / 3;

        vm.prank(user);
        uint256 balBefore = user.balance;
        (uint256 ethOut, bool locked, uint256 cumulativeUnlockThreshold) =
            AFETHV2_PROXY.requestWithdraw(redeemAmount, 0, 0, block.timestamp);
        uint256 ethReceived = user.balance - balBefore;
        assertEq(ethOut, ethReceived);

        assertTrue(locked);

        uint256 cvxLocked = VotiumStrategy(payable(VOTIUM_PROXY)).withdrawableAfterUnlocked(user, cumulativeUnlockThreshold);

        uint256 ethValue = CvxEthOracleLib.convertToEth(cvxLocked) + ethReceived;

        assertApproxEqRelDecimal(
            ethValue,
            value * redeemAmount / amountOut,
            0.005e18,
            18,
            "Received value not approx. staked value (within 0.5%)"
        );

        skip(20 weeks);

        uint256 cvxBefore = IERC20(CVX).balanceOf(user);
        vm.prank(user);
        VotiumStrategy(payable(VOTIUM_PROXY)).withdrawLocked(cumulativeUnlockThreshold, 0, block.timestamp);
        uint256 cvxAfter = IERC20(CVX).balanceOf(user);

        assertEq(cvxAfter - cvxBefore, cvxLocked);
    }

    function testRewardDistributionAccruesFees() public {

        // upgrade implementation
        _upgradeImplementation();

        _deposit("user", 13.21 ether);

        vm.prank(OWNER);
        uint16 fee = 0.05e4;
        AFETHV2_PROXY.setProtocolFee(fee);

        uint256 ethOwedToOwnerBefore = AFETHV2_PROXY.ethOwedToOwner();

        uint256 reward = 4.2 ether;
        hoax(REWARDER, reward);
        AFETHV2_PROXY.depositRewardsAndRebalance{value: reward}(IAfEth.RebalanceParams(0, 0, 0, block.timestamp));

        uint256 accruedFee = reward * fee / 1e4;
        assertEq(AFETHV2_PROXY.ethOwedToOwner(), accruedFee + ethOwedToOwnerBefore, "accrued fee not owed to owner");

        uint256 balanceBefore = OWNER.balance;
        uint256 useMax = 1 << 255;
        vm.prank(OWNER);
        AFETHV2_PROXY.withdrawOwnerFunds(useMax, useMax);
        uint256 received = OWNER.balance - balanceBefore;
        assertEq(received, accruedFee + ethOwedToOwnerBefore);
    }

    function testQuickDeposit() public {

        // upgrade implementation
        _upgradeImplementation();

        uint256 totalAmount = 7 ether;
        uint256 convertAmount = 3 ether;
        uint256 ethAmount = totalAmount - convertAmount;
        uint256 ethOwedToOwnerBefore = AFETHV2_PROXY.ethOwedToOwner();
        uint256 sharesBefore = AFETHV2_PROXY.balanceOf(address(AFETHV2_PROXY));

        startHoax(OWNER, totalAmount);
        uint256 sharesOut = AFETHV2_PROXY.deposit{value: convertAmount}(0, block.timestamp);
        uint16 depositFee = 0.01e4;
        AFETHV2_PROXY.configureQuickActions(depositFee, 0, type(uint128).max, type(uint128).max);
        AFETHV2_PROXY.depositForQuickActions{value: ethAmount}(1 << 248);
        vm.stopPrank();

        assertEq(AFETHV2_PROXY.ethOwedToOwner(), ethAmount + ethOwedToOwnerBefore, "eth owed to owner doesn't match deposited eth");
        assertEq(AFETHV2_PROXY.balanceOf(address(AFETHV2_PROXY)), sharesOut + sharesBefore, "shares owned by vault don't match entire balance");

        uint256 price = AFETHV2_PROXY.price();
        address user = makeAddr("user");
        uint256 quickDepositAmount = 2 ether;
        hoax(user, quickDepositAmount);
        sharesOut = AFETHV2_PROXY.quickDeposit{value: quickDepositAmount}(0, block.timestamp);
        assertEq(ethAmount + quickDepositAmount + ethOwedToOwnerBefore, AFETHV2_PROXY.ethOwedToOwner(), "testQuickDeposit: E0");
        uint256 directShares = quickDepositAmount * 1e18 / price;
        directShares -= directShares * depositFee / 1e4;
        assertEq(sharesOut, directShares, "testQuickDeposit: E1");
    }

    function testQuickWithdraw() public {

        // upgrade implementation
        _upgradeImplementation();

        uint256 totalAmount = 7 ether;
        uint256 convertAmount = 3 ether;
        uint256 ethAmount = totalAmount - convertAmount;
        uint256 ethOwedToOwnerBefore = AFETHV2_PROXY.ethOwedToOwner();

        startHoax(OWNER, totalAmount);
        uint256 sharesOut = AFETHV2_PROXY.deposit{value: convertAmount}(0, block.timestamp);
        uint16 withdrawFee = 0.0134e4;
        AFETHV2_PROXY.configureQuickActions(0, withdrawFee, type(uint128).max, type(uint128).max);
        AFETHV2_PROXY.depositForQuickActions{value: ethAmount}(1 << 248);
        vm.stopPrank();

        uint256 amount = 1.13 ether;
        address user = makeAddr("user");
        uint256 price = AFETHV2_PROXY.price();
        startHoax(user, amount);
        sharesOut = AFETHV2_PROXY.deposit{value: amount}(0, block.timestamp);

        uint256 sharesReservesBefore = AFETHV2_PROXY.balanceOf(address(AFETHV2_PROXY));
        uint256 ethBalBefore = user.balance;
        uint256 ethOut = AFETHV2_PROXY.quickWithdraw(sharesOut, 0, block.timestamp);
        uint256 expectedEthOut = sharesOut * price / 1e18;
        expectedEthOut -= expectedEthOut * withdrawFee / 1e4;
        assertEq(expectedEthOut, ethOut, "incorrect eth amount out");
        assertEq(user.balance, ethBalBefore + ethOut, "eth out not received");
        assertEq(AFETHV2_PROXY.balanceOf(address(AFETHV2_PROXY)), sharesReservesBefore + sharesOut, "held share sincorrect");
        assertEq(AFETHV2_PROXY.ethOwedToOwner(), ethAmount - ethOut + ethOwedToOwnerBefore, "eth owed to owner incorrect");
    }

    function testFullDepositCycle() public {

        // upgrade implementation
        _upgradeImplementation();

        address user = makeAddr("user");
        uint256 amount = 1.31 ether;
        startHoax(user, amount);
        uint256 sharesOut = AFETHV2_PROXY.deposit{value: amount}(0, block.timestamp);
        assertEq(AFETHV2_PROXY.balanceOf(user), sharesOut, "didn't receive shares");

        skip(30 weeks);

        (uint256 ethOut, bool locked, uint256 unlockThreshold) = AFETHV2_PROXY.requestWithdraw(sharesOut, 0, 0, block.timestamp);
        assertEq(AFETHV2_PROXY.balanceOf(user), 0, "shares weren't redeemed");
        assertFalse(locked, "locked");
        assertEq(unlockThreshold, 0, "not locked but threshold: 0");

        assertApproxEqRel(ethOut, amount, 0.005e18, "unlocked ETH not equal to amount");
    }

    // ------------------------------------------------------------
    // Internal Functions
    // ------------------------------------------------------------

    function _upgradeImplementation() internal {
        bytes memory emptyData = "";
        vm.prank(OWNER);
        UUPSUpgradeable(PROXY).upgradeToAndCall(newImplementation, emptyData);
    }

    function _deposit(string memory label, uint256 amount) internal returns (uint256 amountOut) {
        hoax(makeAddr(label), amount);
        amountOut = AFETHV2_PROXY.deposit{value: amount}(0, block.timestamp);
    }
}