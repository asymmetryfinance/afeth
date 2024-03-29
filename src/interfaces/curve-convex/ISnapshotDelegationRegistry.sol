// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISnapshotDelegationRegistry {
    function setDelegate(bytes32 id, address delegate) external;

    function clearDelegate(bytes32 id) external;

    function delegation(bytes32 id, address owner) external returns (address);
}
