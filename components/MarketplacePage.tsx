import React, { useState, useEffect, useCallback } from 'react';
import { ProductSummary, User, PeerShop, PeerListing, MarketplaceListing, DanInventoryOffer } from '../types';
import * as backendService from '../services/backendService';
import { getMyMarketplaceListings, listProductOnMarketplace, getDanInventoryOffers } from '../services/vectorDBService';
import ListProductModal from './ListProductModal';
import { ENABLE_DAN_EXPERIMENT } from '../config';

interface MarketplacePageProps {
  summaries: ProductSummary[];
  user: User;
  onPurchase: (item: PeerListing, quantity: number) => void;
}

const MarketplacePage: React.FC<MarketplacePageProps> = ({ summaries, user, onPurchase }) => {
  const [peerData, setPeerData] = useState<PeerShop[]>([]);
  const [myListings, setMyListings] = useState<MarketplaceListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'peer' | 'dan'>('peer');
  const [danOffers, setDanOffers] = useState<DanInventoryOffer[]>([]);
  const [isDanLoading, setIsDanLoading] = useState(false);
  const [danError, setDanError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!user.isVerified) {
        setIsLoading(false);
        return;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      const [peers, listings] = await Promise.all([
        backendService.getPeerMarketplaceData(user),
        getMyMarketplaceListings()
      ]);
      setPeerData(peers);
      setMyListings(listings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplace data.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const fetchDanOffers = useCallback(async () => {
    if (!ENABLE_DAN_EXPERIMENT) return;
    setIsDanLoading(true);
    setDanError(null);
    try {
      const offers = await getDanInventoryOffers();
      setDanOffers(offers);
    } catch (err) {
      setDanError(err instanceof Error ? err.message : 'Failed to load DAN offers.');
    } finally {
      setIsDanLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!ENABLE_DAN_EXPERIMENT) return;
    if (viewMode === 'dan') {
      fetchDanOffers();
    }
  }, [viewMode, fetchDanOffers]);

  const handleListProduct = async (productName: string, quantity: number, price: number) => {
    const product = summaries.find(s => s.productName === productName);
    if (!product) return;
    
    const productId = productName.toLowerCase().replace(/ /g, '-');
    await listProductOnMarketplace({ productId, productName, quantity, price });
    setIsModalOpen(false);
    fetchData(); // Refresh listings
  };

  const handleDanOfferInterest = (offer: DanInventoryOffer) => {
    alert(`Signal sent! Coordinate with ${offer.shopName || offer.shopId} to fulfill ${offer.productName}.`);
  };
  
  const handleBuyItem = (item: PeerListing) => {
      const quantity = prompt(`How many units of ${item.productName} would you like to buy? (Available: ${item.quantity})`, "1");
      if (quantity) {
          const numQuantity = parseInt(quantity, 10);
          if (!isNaN(numQuantity) && numQuantity > 0 && numQuantity <= item.quantity) {
              onPurchase(item, numQuantity);
              alert(`Successfully purchased ${numQuantity} ${item.productName}! It has been added to your inventory.`);
          } else {
              alert("Invalid quantity entered.");
          }
      }
  }

  if (!user.isVerified) {
    return (
        <div className="text-center bg-gray-800/50 p-12 rounded-lg border border-gray-700">
            <h1 className="text-2xl font-bold text-yellow-400">Verification Pending</h1>
            <p className="text-lg text-gray-400 mt-2">Your shop is awaiting verification by the network admin.</p>
            <p className="text-gray-500 mt-4">Once verified, you will be able to access the peer-to-peer marketplace here.</p>
            <p className="text-gray-500 mt-1">Navigate to the "Backend" tab to simulate the admin view and verify this shop.</p>
        </div>
    );
  }

  return (
    <>
      {isModalOpen && (
        <ListProductModal
          summaries={summaries}
          onClose={() => setIsModalOpen(false)}
          onListProduct={handleListProduct}
        />
      )}
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Marketplace</h1>
          <p className="text-lg text-gray-400">Buy and sell inventory with other verified shops in the network.</p>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4">
            <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
              <h2 className="text-xl font-semibold text-white mb-4">My Listings</h2>
              <button
                onClick={() => setIsModalOpen(true)}
                className="w-full text-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-indigo-500 transition-all"
              >
                List a Product
              </button>
              <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
                {myListings.length > 0 ? (
                  myListings.map(item => (
                    <div key={item.id} className="p-3 bg-gray-900/50 rounded-md text-sm">
                      <p className="font-semibold text-white">{item.productName}</p>
                      <p className="text-gray-400">{item.quantity} units at ${item.price.toFixed(2)}/each</p>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-gray-500 py-4">You haven't listed any products.</p>
                )}
              </div>
            </div>
          </div>
          
          <div className="lg:col-span-8">
            <div className="bg-gray-800/50 p-6 rounded-lg border border-gray-700">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <h2 className="text-xl font-semibold text-white">
                  {viewMode === 'dan' ? 'DAN Offers' : 'Peer Offerings'}
                </h2>
                {ENABLE_DAN_EXPERIMENT && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setViewMode('peer')}
                      className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
                        viewMode === 'peer'
                          ? 'bg-cyan-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      Peer Network
                    </button>
                    <button
                      onClick={() => setViewMode('dan')}
                      className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
                        viewMode === 'dan'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      DAN Offers Only
                    </button>
                  </div>
                )}
              </div>

              {viewMode === 'peer' && (
                <>
                  {isLoading && <p className="text-cyan-400 mt-4">Loading peer listings...</p>}
                  {error && <p className="text-red-400 mt-4">{error}</p>}
                  {!isLoading && !error && (
                    <div className="space-y-6 mt-4">
                      {peerData.map(peer => (
                        <div key={peer.id}>
                          <h3 className="text-lg font-bold text-cyan-400">{peer.name}</h3>
                          <div className="mt-2 divide-y divide-gray-700 border-t border-b border-gray-700">
                            {peer.listings.map(item => (
                              <div key={item.listingId} className="p-3 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                                <div>
                                  <p className="font-semibold text-white">{item.productName}</p>
                                  <p className="text-xs text-gray-400">{item.manufacturer}</p>
                                </div>
                                <div className="text-sm">
                                  <p className="text-gray-300">
                                    {item.quantity} {item.quantityType}
                                  </p>
                                </div>
                                <div className="text-sm font-bold">
                                  <p className="text-white">${item.price.toFixed(2)}</p>
                                </div>
                                <div>
                                  <button
                                    onClick={() => handleBuyItem(item)}
                                    className="w-full md:w-auto text-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-all"
                                  >
                                    Buy
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {viewMode === 'dan' && ENABLE_DAN_EXPERIMENT && (
                <div className="mt-4 space-y-4">
                  {isDanLoading && <p className="text-indigo-300">Syncing DAN offers...</p>}
                  {danError && <p className="text-red-400">{danError}</p>}
                  {!isDanLoading && !danError && (
                    <>
                      {danOffers.filter(offer => offer.shopId !== (user.shopId || user.clientId)).length === 0 ? (
                        <p className="text-gray-400">
                          No external DAN offers yet. Encourage peers to opt-in sharing from Inventory &gt; Manual Entry.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-4">
                          {danOffers
                            .filter(offer => offer.shopId !== (user.shopId || user.clientId))
                            .map(offer => (
                              <div key={offer.inventoryUuid} className="p-4 rounded-lg border border-gray-700 bg-gray-900/40">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-lg font-semibold text-white">{offer.productName}</p>
                                    <p className="text-xs text-gray-400">
                                      From {offer.shopName || offer.shopId}
                                    </p>
                                  </div>
                                  <span className="text-xs px-2 py-1 rounded-full border border-indigo-400 text-indigo-300">
                                    DAN
                                  </span>
                                </div>
                                <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm text-gray-300">
                                  <div>
                                    <p className="text-gray-400 text-xs uppercase">Quantity</p>
                                    <p>{offer.quantity} units</p>
                                  </div>
                                  <div>
                                    <p className="text-gray-400 text-xs uppercase">Expires</p>
                                    <p>{new Date(offer.expirationDate).toLocaleDateString()}</p>
                                  </div>
                                  <div>
                                    <p className="text-gray-400 text-xs uppercase">Aisle Zone</p>
                                    <p>{offer.locationBucket || 'Hidden'}</p>
                                  </div>
                                  <div>
                                    <p className="text-gray-400 text-xs uppercase">Signal Hash</p>
                                    <p className="font-mono text-xs">{offer.proofHash?.slice(0, 12) ?? '—'}</p>
                                  </div>
                                </div>
                                <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                  <div className="text-sm text-gray-400">
                                    {offer.sellPrice ? `Listed at $${offer.sellPrice.toFixed(2)} / unit` : 'Price shared privately'}
                                  </div>
                                  <button
                                    onClick={() => handleDanOfferInterest(offer)}
                                    className="w-full md:w-auto text-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-indigo-500 transition-all"
                                  >
                                    Signal Interest
                                  </button>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default MarketplacePage;