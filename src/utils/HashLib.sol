// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library HashLib {
    function hash(string memory str) internal pure returns (bytes32 strHash) {
        /// @solidity memory-safe-assembly
        assembly {
            strHash := keccak256(add(str, 0x20), mload(str))
        }
    }
}
