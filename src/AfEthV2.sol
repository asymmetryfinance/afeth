// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {SFRX_ETH} from "./interfaces/frax/ISfrxETH.sol";

import {IEigenLayerStrategyManager, IERC20} from "./interfaces/IEigenLayerStrategyManager.sol";
import {IEigenLayerStrategy} from "./interfaces/IEigenLayerStrategy.sol";
import {IDelegationManager} from "./interfaces/IDelegationManager.sol";

import {AfEth} from "./AfEth.sol";

contract AfEthV2 is AfEth {

    bool private eigenlayerInitialized;

    IEigenLayerStrategyManager public eigenlayerStrategyManager;
    IEigenLayerStrategy public sfrxETHEigenlayerStrategy;
    IDelegationManager public eigenlayerDelegationManager;

    event EigenLayerInitialized(
        address indexed strategyManager,
        address indexed sfrxETHStrategy,
        address indexed delegationManager
    );

    event DepositToEigenlayer(uint256 amount);

    error ZeroAddress();
    error EigenLayerInitialized();
    error InsufficientBalance();

    constructor(address _votium) AfEth(_votium) {}

    function initializeEigenlayer(
        address _strategyManager,
        address _sfrxETHStrategy,
        address _delegationManager
    ) external onlyOwner {
        if (eigenlayerInitialized) revert EigenLayerInitialized();
        if (
            _strategyManager == address(0) ||
            _sfrxETHStrategy == address(0) ||
            _delegationManager == address(0)
        ) revert ZeroAddress();

        eigenlayerInitialized = true;

        eigenlayerStrategyManager = IEigenLayerStrategyManager(_strategyManager);
        sfrxETHEigenlayerStrategy = IEigenLayerStrategy(_sfrxETHStrategy);
        eigenlayerDelegationManager = IDelegationManager(_delegationManager);

        emit EigenLayerInitialized(_strategyManager, _sfrxETHStrategy, _delegationManager);

        IERC20(address(SFRX_ETH)).approve(_strategyManager, type(uint256).max);
    }

    function depositToEigenlayer(uint256 _amount) external onlyOwner {

        IERC20 _sfrxETH = IERC20(address(SFRX_ETH));
        if (_sfrxETH.balanceOf(address(this)) < _amount) revert InsufficientBalance();

        emit DepositToEigenlayer(_amount);

        eigenlayerStrategyManager.depositIntoStrategy(sfrxETHEigenlayerStrategy, _sfrxETH, _amount);
    }

    function withdrawToEigenlayer() external onlyOwner {}

    function delegateToEigenlayerOperator() external onlyOwner {}

    function undelegateFromEigenlayerOperator() external onlyOwner {}

    // @todo - rewrite `deposit` and `withdraw` functions to take into account sfrxETH that is in EL (also what happens on slashing?)

    // @todo - what about claiming rewards/points from EL?
}