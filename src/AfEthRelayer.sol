// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {IAfEth} from "./interfaces/afeth/IAfEth.sol";
import {ISafEth} from "./interfaces/safeth/ISafEth.sol";
import {IWETH, WETH} from "./interfaces/IWETH.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEthRelayer is Initializable {
    using SafeTransferLib for address;

    ISafEth public constant SAF_ETH = ISafEth(0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5);
    IAfEth public constant AF_ETH = IAfEth(0x00000000fbAA96B36A2AcD4B7B36385c426B119D);

    address internal constant ZERO_X_EXCHANGE = 0xDef1C0ded9bec7F1a1670819833240f027b25EfF;
    address internal constant ZERO_X_ERC20_PROXY = 0x95E6F48254609A6ee006F7D493c8e5fB97094ceF;

    struct SwapParams {
        address sellToken;
        uint256 amount;
        bytes swapCallData;
    }

    error NotWhitelisted();
    error SwapFailed();

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    // Payable fallback to allow this contract to receive protocol fee refunds.
    receive() external payable {}

    /**
     * @notice - Initialize values for the contracts
     * @dev - This replaces the constructor for upgradeable contracts
     */
    function initialize() external initializer {}

    /**
     * @notice Deposits into the SafEth contract and relay to owner address
     * @param minOut Minimum amount of safETH to mint
     * @param params Parameters passed to zerox
     */
    function depositSafEth(uint256 minOut, SwapParams calldata params) external payable {
        _swapToEth(params);

        uint256 amountToTransfer = SAF_ETH.stake{value: address(this).balance}(minOut);
        address(SAF_ETH).safeTransfer(msg.sender, amountToTransfer);
    }

    /**
     * @notice Does a direct deposit into the AfEth contract and relay to caller
     * @param minOut Minimum amount of afETH to mint
     * @param deadline Time before transaction expires
     * @param params Owner of the AfEth
     */
    function depositAfEth(uint256 minOut, uint256 deadline, SwapParams calldata params) external payable {
        _swapToEth(params);
        AF_ETH.deposit{value: address(this).balance}(msg.sender, minOut, deadline);
    }

    /**
     * @notice Does a quick deposit into the AfEth contract and relay to caller
     * @param minOut Minimum amount of afETH to mint
     * @param deadline Time before transaction expires
     * @param params Owner of the AfEth
     */
    function quickDepositAfEth(uint256 minOut, uint256 deadline, SwapParams calldata params) external payable {
        _swapToEth(params);
        AF_ETH.quickDeposit{value: address(this).balance}(msg.sender, minOut, deadline);
    }

    function _swapToEth(SwapParams calldata params) internal {
        _fillQuote(params);
        uint256 totalBal = WETH.balanceOf(address(this));
        IWETH(WETH).withdraw(totalBal);
    }

    /// @dev Swaps ERC20->ERC20 tokens held by this contract using a 0x-API quote.
    function _fillQuote(SwapParams calldata params) private {
        params.sellToken.safeTransferFrom(msg.sender, address(this), params.amount);
        params.sellToken.safeApproveWithRetry(ZERO_X_ERC20_PROXY, params.amount);

        (bool success,) = ZERO_X_EXCHANGE.call(params.swapCallData);
        if (!success) revert SwapFailed();
    }
}
