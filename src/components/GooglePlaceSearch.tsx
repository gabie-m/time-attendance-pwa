import { useEffect, useRef, useState } from 'react';
import type { LocationFormInput } from '../services/mockLocationService';
import {
  hasGoogleMapsApiKey,
  loadGooglePlacesLibrary,
  mapGooglePlaceToLocationForm
} from '../services/googlePlacesService';

type GooglePlaceSearchProps = {
  onPlaceSelected: (values: Partial<LocationFormInput>) => void;
};

type GooglePlaceSelectEvent = Event & {
  placePrediction?: {
    toPlace: () => {
      fetchFields: (options: { fields: string[] }) => Promise<void>;
      displayName?: string;
      formattedAddress?: string;
      location?: {
        lat: () => number;
        lng: () => number;
      };
    };
  };
};

export function GooglePlaceSearch({ onPlaceSelected }: GooglePlaceSearchProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState(
    hasGoogleMapsApiKey()
      ? 'Loading Google address search...'
      : 'Google address search is available after adding VITE_GOOGLE_MAPS_API_KEY.'
  );

  useEffect(() => {
    let cancelled = false;

    async function mountAutocomplete() {
      if (!hasGoogleMapsApiKey() || !containerRef.current) {
        return;
      }

      try {
        await loadGooglePlacesLibrary();
        const placesLibrary = await window.google?.maps?.importLibrary?.('places');
        if (!placesLibrary || cancelled || !containerRef.current) {
          return;
        }

        containerRef.current.innerHTML = '';
        const autocompleteElement = new placesLibrary.PlaceAutocompleteElement();
        autocompleteElement.addEventListener('gmp-select', async (event: GooglePlaceSelectEvent) => {
          const place = event.placePrediction?.toPlace();
          if (!place) {
            return;
          }

          await place.fetchFields({
            fields: ['displayName', 'formattedAddress', 'location']
          });
          onPlaceSelected(mapGooglePlaceToLocationForm(place));
          setStatus('Address selected. Review radius before saving.');
        });
        containerRef.current.appendChild(autocompleteElement);
        setStatus('Search for a place or address.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Google address search failed to load.');
      }
    }

    void mountAutocomplete();

    return () => {
      cancelled = true;
    };
  }, [onPlaceSelected]);

  return (
    <div className="google-place-search">
      <div ref={containerRef} />
      <p>{status}</p>
    </div>
  );
}
