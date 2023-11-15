// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./external_interfaces/IAfEth.sol";
import "./external_interfaces/IWETH.sol";
import "contracts/external_interfaces/ISafEth.sol";
import "contracts/strategies/AbstractStrategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEthRelayer is Initializable {
    address public constant SAF_ETH_ADDRESS =
        0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5;
    address public constant AF_ETH_ADDRESS =
        0x5F10B16F0959AaC2E33bEdc9b0A4229Bb9a83590;
    address public constant WETH_ADDRESS =
        0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    event DepositSafEth(address indexed sellToken, uint256 sellAmount, uint256 safEthAmount, address indexed recipient);
    event DepositAfEth(address indexed sellToken, uint256 sellAmount, uint256 afEthAmount, address indexed recipient);

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
    */
    function initialize() external initializer {}

    // Swaps ERC20->ERC20 tokens held by this contract using a 0x-API quote.
    function fillQuote(
        IERC20 sellToken,
        uint256 amount,
        address spender,
        address payable swapTarget,
        bytes calldata swapCallData
    ) private {
        sellToken.transferFrom(msg.sender, address(this), amount);

        require(
            sellToken.approve(spender, type(uint256).max),
            "Approve Failed"
        );

        (bool success, ) = swapTarget.call(swapCallData);
        require(success, "Swap Failed");
    }

    /**
        @notice - Deposits into the SafEth contract and relay to owner address
        @param _minout - Minimum amount of SafEth to mint
        @param _owner - Owner of the SafEth
    */
    function depositSafEth(
        uint256 _minout,
        address _owner,
        address _sellToken,
        uint256 _amount,
        address _allowanceTarget,
        address payable _to,
        bytes calldata _swapCallData
    ) external payable {
        uint256 balanceBefore = IERC20(WETH_ADDRESS).balanceOf(address(this));
        fillQuote(
            IERC20(_sellToken),
            _amount,
            _allowanceTarget,
            _to,
            _swapCallData
        );
        uint256 balanceAfter = IERC20(WETH_ADDRESS).balanceOf(address(this));
        uint256 amountToStake = balanceAfter - balanceBefore;
        IWETH(WETH_ADDRESS).withdraw(amountToStake);

        uint256 beforeDeposit = IERC20(SAF_ETH_ADDRESS).balanceOf(
            address(this)
        );
        ISafEth(SAF_ETH_ADDRESS).stake{value: amountToStake}(_minout);
        uint256 amountToTransfer = IERC20(SAF_ETH_ADDRESS).balanceOf(
            address(this)
        ) - beforeDeposit;
        IERC20(SAF_ETH_ADDRESS).transfer(_owner, amountToTransfer);
        emit DepositSafEth(_sellToken, _amount, amountToTransfer, _owner);
    }

    /**
        @notice - Deposits into the AfEth contract and relay to owner address
        @param _minout - Minimum amount of AfEth to mint
        @param _deadline - Time before transaction expires
        @param _owner - Owner of the AfEth
    */
    function depositAfEth(
        uint256 _minout,
        uint256 _deadline,
        address _owner,
        address _sellToken,
        uint256 _amount,
        address _allowanceTarget,
        address payable _to,
        bytes calldata _swapCallData
    ) external payable {
        uint256 balanceBefore = IERC20(WETH_ADDRESS).balanceOf(address(this));
        fillQuote(
            IERC20(_sellToken),
            _amount,
            _allowanceTarget,
            _to,
            _swapCallData
        );
        uint256 balanceAfter = IERC20(WETH_ADDRESS).balanceOf(address(this));
        uint256 amountToStake = balanceAfter - balanceBefore;

        IWETH(WETH_ADDRESS).withdraw(amountToStake);

        uint256 beforeDeposit = IERC20(AF_ETH_ADDRESS).balanceOf(address(this));
        IAfEth(AF_ETH_ADDRESS).deposit{value: amountToStake}(
            _minout,
            _deadline
        );
        uint256 amountToTransfer = IERC20(AF_ETH_ADDRESS).balanceOf(
            address(this)
        ) - beforeDeposit;
        IERC20(AF_ETH_ADDRESS).transfer(_owner, amountToTransfer);
        emit DepositAfEth(_sellToken, _amount, amountToTransfer, _owner);
    }

    // Payable fallback to allow this contract to receive protocol fee refunds.
    receive() external payable {}
}
