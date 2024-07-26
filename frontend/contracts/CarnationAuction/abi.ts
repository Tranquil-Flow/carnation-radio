export const CarnationAuctionABI = [
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "_auctionLength",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "_nftAddress",
          "type": "address"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "constructor"
    },
    {
      "inputs": [],
      "name": "auctionID",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "auctionLength",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "auctions",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "auctionStartTime",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "auctionFinishTime",
          "type": "uint256"
        },
        {
          "internalType": "bool",
          "name": "auctionFinished",
          "type": "bool"
        },
        {
          "internalType": "string",
          "name": "audioName",
          "type": "string"
        },
        {
          "internalType": "uint256",
          "name": "highestBid",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "highestBidder",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "name": "bids",
      "outputs": [
        {
          "internalType": "address",
          "name": "bidder",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "bidAmount",
          "type": "uint256"
        },
        {
          "internalType": "bool",
          "name": "bidWithdrawn",
          "type": "bool"
        },
        {
          "internalType": "bool",
          "name": "winningBid",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "_audioSlotID",
          "type": "uint256"
        }
      ],
      "name": "editBid",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "_audioSlotID",
          "type": "uint256"
        }
      ],
      "name": "endAuction",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "_audioSlotID",
          "type": "uint256"
        }
      ],
      "name": "placeBid",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "_audioSlotID",
          "type": "uint256"
        }
      ],
      "name": "withdrawBid",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ];