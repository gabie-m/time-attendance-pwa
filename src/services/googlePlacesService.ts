import type { LocationFormInput } from './mockLocationService';

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (libraryName: 'places') => Promise<{
          PlaceAutocompleteElement: new () => HTMLElement & {
            addEventListener: (
              eventName: 'gmp-select',
              handler: (event: GooglePlaceSelectEvent) => void
            ) => void;
          };
        }>;
      };
    };
  }
}

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

let googleMapsLoaderPromise: Promise<void> | null = null;

export function hasGoogleMapsApiKey() {
  return Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);
}

export async function loadGooglePlacesLibrary() {
  if (!hasGoogleMapsApiKey()) {
    throw new Error('Google Maps API key is not configured.');
  }

  if (window.google?.maps?.importLibrary) {
    return;
  }

  googleMapsLoaderPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&v=weekly&libraries=places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Google Maps script.'));
    document.head.appendChild(script);
  });

  await googleMapsLoaderPromise;
}

export function mapGooglePlaceToLocationForm(place: {
  displayName?: string;
  formattedAddress?: string;
  location?: { lat: () => number; lng: () => number };
}): Partial<LocationFormInput> {
  return {
    name: place.displayName ?? '',
    address: place.formattedAddress ?? '',
    latitude: place.location?.lat() ?? 0,
    longitude: place.location?.lng() ?? 0
  };
}
