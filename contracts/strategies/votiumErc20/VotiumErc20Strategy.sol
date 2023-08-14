// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractErc20Strategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./VotiumErc20StrategyCore.sol";
import "hardhat/console.sol";

// TODO rename things from afEth to something else
contract VotiumErc20Strategy is VotiumErc20StrategyCore, AbstractErc20Strategy {
    function price() public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        (, , uint256 locked, ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        if (locked == 0) return 1e18;
        return (locked * 1e18) / supply;
    }

    function mint() public payable override {
        uint256 priceBefore = price();
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);
        _mint(msg.sender, ((cvxAmount * 1e18) / priceBefore));
    }

    function requestWithdraw(uint256 _amount) public override {
        unlockQueue[queueSize] = UnlockQueuePosition({
            owner: msg.sender,
            afEthOwed: (_amount),
            afEthWithdrawn: 0
        });

        afEthUnlockObligations += unlockQueue[queueSize].afEthOwed;
        queueSize++;
    }

    function requestWithdrawArray(uint256 _amount) public {
        // unlockQueue[queueSize] = UnlockQueuePosition({
        //     owner: msg.sender,
        //     afEthOwed: (_amount),
        //     afEthWithdrawn: 0
        // });
        _burn(msg.sender, _amount);
        unlockQueueArray.push(
            AddressAndAmount(msg.sender, _amount, _amount * price()) // TODO change from msg.sender to real owner
        );
        // afEthUnlockObligations += unlockQueue[queueSize].afEthOwed;
        // queueSize++;
    }

    // will only find first available
    function findIndexInArrayAndVerifyAvailableWithdraw(
        address sender,
        AddressAndAmount[] memory arr,
        uint256 unlockedCvxBalance
    ) public view returns (uint256) {
        // Check total amount of CVX to withdraw for user & everyone in front
        uint availableAmount = 0;

        for (uint i = 0; i < arr.length; i++) {
            if (sender == arr[i].account) {
                console.log("FOUND");
                require(
                    availableAmount > unlockedCvxBalance,
                    "Not enough unlocked CVX"
                );
                return i;
            }
            availableAmount += unlockQueueArray[i].cvxAmount;
        }

        // return -1; //throw
    }

    // TODO look into gas costs of this
    function withdrawArray() public {
        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        if (unlockable == 0) return;

        // unlock all (theres no way to unlock individual locks)
        ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);
        uint256 unlockedCvxBalance = IERC20(CVX_ADDRESS).balanceOf(
            address(this)
        );
        require(unlockedCvxBalance > 0, "No unlocked CVX to process");
        console.log("unlockedCvxBalance", unlockedCvxBalance);

        uint position = findIndexInArrayAndVerifyAvailableWithdraw(
            msg.sender,
            unlockQueueArray,
            unlockedCvxBalance
        );
        console.log("Position", position);
        require(msg.sender == unlockQueueArray[position].account, "Not owner"); // replace with original msg.sender

        sellCvx(unlockQueueArray[position].cvxAmount);

        // use call to send eth instead & replace with owner of account
        payable(msg.sender).transfer(address(this).balance);
    }

    // TODO look into gas costs of this
    function processWithdrawQueue(uint _maxIterations) public override {
        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        if (unlockable == 0) return;

        // get price before nlocking change the prices
        uint256 priceBeforeUnlock = price();

        // unlock all (theres no way to unlock individual locks)
        ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);
        uint256 unlockedCvxBalance = IERC20(CVX_ADDRESS).balanceOf(
            address(this)
        );
        require(unlockedCvxBalance > 0, "No unlocked CVX to process queue");
        console.log("unlockedCvxBalance", unlockedCvxBalance);

        uint256 cvxUnlockObligations = (afEthUnlockObligations *
            priceBeforeUnlock) / 1e18;
        console.log("cvxUnlockObligations", cvxUnlockObligations);

        // relock everything minus unlock queue obligations
        uint256 cvxAmountToRelock = cvxUnlockObligations > unlockedCvxBalance
            ? 0
            : unlockedCvxBalance - cvxUnlockObligations;
        if (cvxAmountToRelock > 0) {
            IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmountToRelock);
            ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmountToRelock, 0);
        }
        uint256 i;
        console.log("cvxAmountToRelock", cvxAmountToRelock);

        for (i = nextQueuePositionToProcess; i < queueSize; i++) {
            if (unlockedCvxBalance == 0) return;
            if (_maxIterations == 0) break;
            _maxIterations--;
            console.log("i", i);

            UnlockQueuePosition storage position = unlockQueue[i];

            // look into precision loss here, why does it become inexact?
            uint256 remainingCvxToWithdrawFromPosition = ((position.afEthOwed -
                position.afEthWithdrawn) * priceBeforeUnlock) / 1e18;

            if (remainingCvxToWithdrawFromPosition == 0) continue;

            uint256 cvxToSell = remainingCvxToWithdrawFromPosition >=
                unlockedCvxBalance
                ? unlockedCvxBalance
                : remainingCvxToWithdrawFromPosition;
            // fix edge case where roundoff error can made it higher than balance on edge case
            cvxToSell = unlockedCvxBalance > cvxToSell
                ? cvxToSell
                : unlockedCvxBalance;

            uint256 afEthToBurn = (cvxToSell * 1e18) / priceBeforeUnlock;

            // fixes roundoff error bug that can cause underflow edge case
            afEthToBurn = afEthToBurn > address(this).balance
                ? address(this).balance
                : afEthToBurn;
            unlockedCvxBalance -= cvxToSell;
            afEthUnlockObligations -= afEthToBurn;
            position.afEthWithdrawn += afEthToBurn;
            _burn(msg.sender, afEthToBurn);
            sellCvx(cvxToSell);

            // use call to send eth instead
            payable(position.owner).transfer(address(this).balance);
        }
        nextQueuePositionToProcess = i;
    }
}
