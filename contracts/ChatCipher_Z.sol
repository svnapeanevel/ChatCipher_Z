pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ChatCipher_Z is ZamaEthereumConfig {
    struct Message {
        address sender;
        euint32 encryptedContent;
        uint256 timestamp;
        bool isSpam;
        bool isDecrypted;
    }

    mapping(address => Message[]) public userMessages;
    mapping(address => mapping(uint256 => bool)) public messageSpamStatus;

    event MessageSent(address indexed sender, address indexed receiver, uint256 timestamp);
    event MessageFiltered(address indexed sender, address indexed receiver, uint256 messageIndex, bool isSpam);
    event MessageDecrypted(address indexed sender, address indexed receiver, uint256 messageIndex);

    constructor() ZamaEthereumConfig() {
    }

    function sendMessage(
        address receiver,
        externalEuint32 encryptedContent,
        bytes calldata inputProof
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedContent, inputProof)), "Invalid encrypted content");

        Message memory newMessage = Message({
            sender: msg.sender,
            encryptedContent: FHE.fromExternal(encryptedContent, inputProof),
            timestamp: block.timestamp,
            isSpam: false,
            isDecrypted: false
        });

        userMessages[receiver].push(newMessage);
        FHE.allowThis(userMessages[receiver][userMessages[receiver].length - 1].encryptedContent);
        FHE.makePubliclyDecryptable(userMessages[receiver][userMessages[receiver].length - 1].encryptedValue);

        emit MessageSent(msg.sender, receiver, block.timestamp);
    }

    function filterSpam(
        address receiver,
        uint256 messageIndex,
        bytes calldata filterProof
    ) external {
        require(messageIndex < userMessages[receiver].length, "Invalid message index");
        require(!userMessages[receiver][messageIndex].isSpam, "Message already filtered");

        bool isSpam = FHE.verifyFilter(userMessages[receiver][messageIndex].encryptedContent, filterProof);
        userMessages[receiver][messageIndex].isSpam = isSpam;
        messageSpamStatus[receiver][messageIndex] = isSpam;

        emit MessageFiltered(userMessages[receiver][messageIndex].sender, receiver, messageIndex, isSpam);
    }

    function decryptMessage(
        address receiver,
        uint256 messageIndex,
        bytes calldata decryptionProof
    ) external {
        require(messageIndex < userMessages[receiver].length, "Invalid message index");
        require(!userMessages[receiver][messageIndex].isDecrypted, "Message already decrypted");
        require(msg.sender == receiver, "Only receiver can decrypt");

        bytes memory decryptedContent = FHE.decrypt(
            userMessages[receiver][messageIndex].encryptedContent,
            decryptionProof
        );

        userMessages[receiver][messageIndex].isDecrypted = true;

        emit MessageDecrypted(userMessages[receiver][messageIndex].sender, receiver, messageIndex);
    }

    function getMessage(
        address receiver,
        uint256 messageIndex
    ) external view returns (
        address sender,
        euint32 encryptedContent,
        uint256 timestamp,
        bool isSpam,
        bool isDecrypted
    ) {
        require(messageIndex < userMessages[receiver].length, "Invalid message index");
        Message storage message = userMessages[receiver][messageIndex];
        return (
            message.sender,
            message.encryptedContent,
            message.timestamp,
            message.isSpam,
            message.isDecrypted
        );
    }

    function getMessageCount(address receiver) external view returns (uint256) {
        return userMessages[receiver].length;
    }

    function isSpam(address receiver, uint256 messageIndex) external view returns (bool) {
        return messageSpamStatus[receiver][messageIndex];
    }
}


