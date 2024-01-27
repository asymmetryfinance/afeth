// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {IAfEth} from "./interfaces/afeth/IAfEth.sol";
import {ISafEth} from "./interfaces/safeth/ISafEth.sol";
import {WETH} from "./interfaces/IWETH.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEthRelayer is Initializable {
    using SafeTransferLib for address;

    ISafEth public constant SAF_ETH = ISafEth(0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5);
    IAfEth public immutable AF_ETH;

    address internal constant ZERO_X_EXCHANGE = 0xDef1C0ded9bec7F1a1670819833240f027b25EfF;
    address internal constant ZERO_X_ERC20_PROXY = 0x95E6F48254609A6ee006F7D493c8e5fB97094ceF;

    error NotWhitelisted();
    error SwapFailed();

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address afEth) {
        _disableInitializers();
        AF_ETH = IAfEth(afEth);
    }

    // Payable fallback to allow this contract to receive protocol fee refunds.
    receive() external payable {}

    /**
     * @notice - Initialize values for the contracts
     * @dev - This replaces the constructor for upgradeable contracts
     */
    function initialize() external initializer {}

    /**
     * @notice - Deposits into the SafEth contract and relay to owner address
     * @param minOut - Minimum amount of SafEth to mint
     * @param to - Owner of the SafEth
     */
    function depositSafEth(
        uint256 minOut,
        address to,
        address sellToken,
        uint256 sellAmount,
        address allowanceTarget,
        address swapTarget,
        bytes calldata swapData
    ) external {
        uint256 balanceBefore = WETH.balanceOf(address(this));
        fillQuote(sellToken, sellAmount, allowanceTarget, swapTarget, swapData);
        uint256 balanceAfter = WETH.balanceOf(address(this));
        uint256 amountToStake = balanceAfter - balanceBefore;
        WETH.withdraw(amountToStake);

        uint256 amountToTransfer = SAF_ETH.stake{value: amountToStake}(minOut);
        address(SAF_ETH).safeTransfer(to, amountToTransfer);
    }

    /**
     * @notice - Deposits into the AfEth contract and relay to owner address
     * @param minOut - Minimum amount of AfEth to mint
     * @param deadline - Time before transaction expires
     * @param _owner - Owner of the AfEth
     */
    function depositAfEth(
        uint256 minOut,
        uint256 deadline,
        address _owner,
        address _sellToken,
        uint256 _amount,
        address _allowanceTarget,
        address payable _to,
        bytes calldata _swapCallData
    ) external {
        uint256 balanceBefore = WETH.balanceOf(address(this));
        fillQuote(_sellToken, _amount, _allowanceTarget, _to, _swapCallData);
        uint256 balanceAfter = WETH.balanceOf(address(this));
        uint256 amountToStake = balanceAfter - balanceBefore;

        WETH.withdraw(amountToStake);

        uint256 amountToTransfer = AF_ETH.deposit{value: amountToStake}(minOut, deadline);
        AF_ETH.transfer(_owner, amountToTransfer);
    }

    function whitelisted(address addr) public pure returns (bool) {
        return addr == ZERO_X_EXCHANGE || addr == ZERO_X_ERC20_PROXY;
    }

    /// @dev Swaps ERC20->ERC20 tokens held by this contract using a 0x-API quote.
    function fillQuote(
        address sellToken,
        uint256 amount,
        address spender,
        address swapTarget,
        bytes calldata swapCallData
    ) private {
        if (!whitelisted(swapTarget) || !whitelisted(spender)) {
            revert NotWhitelisted();
        }
        sellToken.safeTransferFrom(msg.sender, address(this), amount);
        sellToken.safeApproveWithRetry(spender, amount);

        // Arbitrary call ok because `swapTarget` needs to be one of the hardcoded whitelisted
        // addresses.
        (bool success,) = swapTarget.call(swapCallData);
        if (!success) revert SwapFailed();
    }
}
