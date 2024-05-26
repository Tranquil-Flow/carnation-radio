"use client";
import React, { useState } from 'react';
import '../styles/App.css';
import Navbar from '../components/Navbar';
import AuctionView from '../components/AuctionView';
// import background from '../components/assets/background.svg';

import Link from "next/link";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { BugAntIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Address } from "~~/components/scaffold-eth";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();

  const [view, setView] = useState('listen');

  const handleNavClick = (view) => {
    setView(view);
  };

  return (
    <div className="app">
    {/* <div className="app" style={{ backgroundImage: `url(${background})` }}> */}
      <Navbar currentView={view} onNavClick={handleNavClick} />
      <div className="main-content">
        {view === 'auction' && <AuctionView />}
        {/* Add the listen view component here */}
      </div>
    </div>
  );

};

export default Home;