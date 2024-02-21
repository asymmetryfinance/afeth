// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @author philogy <https://github.com/philogy>
contract MockSafe {
    error FailedCall();

    receive() external payable {}

    function exec(address to, uint256 amount, bytes calldata payload) external {
        (bool success,) = to.call{value: amount}(payload);
        if (!success) revert FailedCall();
    }
}
