import React from 'react';
import '../styles/AuctionView.css';

const AuctionView = () => {
  const tracks = ['Track 1', 'Track 2', 'Track 3']; // Example tracks
  const bids = [
    { ordinal: 1, username: 'user1', amount: '$100' },
    { ordinal: 2, username: 'user2', amount: '$90' },
  ];

  return (
    <div className="auction-container">
      <div className="auction-column">
        <div className="button bid-button">
          <div>AMOUNT</div>
          <div>BID</div>
        </div>
        <div className="button">EDIT BID</div>
        <div className="button">WITHDRAW</div>
      </div>
      <div className="auction-middle">
        <div className="track-list">
          {tracks.map((track, index) => (
            <div key={index} className="track-item">
              {track}
            </div>
          ))}
        </div>
      </div>
      <div className="auction-column">
        <div className="bids-header">BIDS:</div>
        <div className="bids-list">
          {bids.map((bid, index) => (
            <div key={index} className="bid-item">
              {bid.ordinal}. {bid.username} {bid.amount}
            </div>
          ))}
        </div>
        <div className="end-auction button">END AUCTION</div>
      </div>
    </div>
  );
};

export default AuctionView;
