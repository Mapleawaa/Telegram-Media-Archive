import { create } from 'zustand';

interface ConnectionState {
  online: boolean;
  lastEventAt: number | null;
  setOnline: (online: boolean) => void;
  markEvent: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  online: false,
  lastEventAt: null,
  setOnline: (online) => set({ online }),
  markEvent: () => set({ lastEventAt: Date.now() }),
}));
