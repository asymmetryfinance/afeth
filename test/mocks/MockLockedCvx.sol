// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {ILockedCvx} from "../../src/interfaces/curve-convex/ILockedCvx.sol";
import {CVX} from "../../src/interfaces/curve-convex/Constants.sol";

/// @author philogy <https://github.com/philogy>
contract MockLockedCvx is ILockedCvx {
    using SafeTransferLib for address;

    struct Account {
        uint256 locked;
        uint256 unlocked;
    }

    mapping(address => Account) public accounts;

    bool public isShutdown;

    ////////////////////////////////////////////////////////////////
    //                        TEST HELPERS                        //
    ////////////////////////////////////////////////////////////////

    function setShutdown(bool shutdown) external {
        isShutdown = shutdown;
    }

    function unlock(address user, uint256 amount) external {
        Account storage account = accounts[user];
        account.locked -= amount;
        account.unlocked += amount;
    }

    ////////////////////////////////////////////////////////////////
    //                       MOCK INTERFACE                       //
    ////////////////////////////////////////////////////////////////

    function lock(address user, uint256 amount, uint256) external {
        CVX.safeTransferFrom(msg.sender, address(this), amount);
        accounts[user].locked += amount;
    }

    function processExpiredLocks(bool relock) external {
        // require(!relock, "RELOCK_NOT_SUPPORTED");
        Account storage account = accounts[msg.sender];
        uint256 unlocked = account.unlocked;
        require(unlocked > 0, "no exp locks");
        account.unlocked = 0;

        if (relock) {
            account.locked += unlocked;
        } else {
            CVX.safeTransfer(msg.sender, unlocked);
        }
    }

    function lockedBalanceOf(address user) external view returns (uint256) {
        Account storage account = accounts[user];
        return account.locked + account.unlocked;
    }
}
