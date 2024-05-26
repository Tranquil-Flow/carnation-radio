import React from 'react';
// import '../../styles/Navbar.css';
import logo from './assets/carnation-logo.svg';

const Navbar = ({ currentView, onNavClick }) => {
  return (
    <div className="navbar">
      <img src={logo} alt="Carnation Logo" className="navbar-logo" />
      <div className="navbar-text">
        {['listen', 'download', 'auction'].map((item) => (
          <div
            key={item}
            className={currentView === item ? 'active' : ''}
            onClick={() => onNavClick(item)}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Navbar;


