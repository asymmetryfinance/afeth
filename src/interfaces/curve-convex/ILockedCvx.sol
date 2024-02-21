// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

ILockedCvx constant LOCKED_CVX = ILockedCvx(0x72a19342e8F1838460eBFCCEf09F6585e32db86E);

interface ILockedCvx {
    struct LockedBalance {
        uint112 amount;
        uint112 boosted;
        uint32 unlockTime;
    }

    function lock(address _account, uint256 _amount, uint256 _spendRatio) external;

    function processExpiredLocks(bool relock) external;

    function lockedBalanceOf(address _user) external view returns (uint256 amount);
}
