// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

IVotiumMerkleStash constant VOTIUM_MERKLE_STASH = IVotiumMerkleStash(0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A);

interface IVotiumMerkleStash {
    struct ClaimParam {
        address token;
        uint256 index;
        uint256 amount;
        bytes32[] merkleProof;
    }

    function claimMulti(address account, ClaimParam[] calldata claims) external;
}
