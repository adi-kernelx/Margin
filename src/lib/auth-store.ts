
import { create } from 'zustand';
import {
    type User,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    signOut,
    onAuthStateChanged
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase/config';

interface AuthState {
    user: User | null;
    loading: boolean;
    error: string | null;

    initialize: () => () => void; // Returns unsubscribe function
    signUp: (email: string, pass: string) => Promise<void>;
    login: (email: string, pass: string) => Promise<void>;
    loginWithGoogle: () => Promise<void>;
    logout: () => Promise<void>;
    resetError: () => void;

    // Guest Mode
    isGuest: boolean;
    skipLogin: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    loading: true,
    error: null,
    isGuest: false,


    initialize: () => {
        // Only set loading to true initially, then false after first check
        set({ loading: true });

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            // If user logs in, they are no longer a guest
            if (user) {
                // Client-side user document creation (Spark Plan workaround)
                try {
                    const userRef = doc(db, 'users', user.uid);
                    const userSnap = await getDoc(userRef);

                    if (!userSnap.exists()) {
                        await setDoc(userRef, {
                            uid: user.uid,
                            email: user.email || '',
                            displayName: user.displayName || user.email?.split('@')[0] || 'User',
                            createdAt: serverTimestamp(),
                            freeUploadsUsed: 0,
                            drive: {
                                mode: "app",
                            }
                        });
                        console.log('User document created client-side');
                    }
                } catch (error) {
                    console.error('Error ensuring user document:', error);
                    // Don't block login on error, but log it
                }

                set({ user, loading: false, isGuest: false });
            } else {
                set({ user: null, loading: false });
            }
        }, (error) => {
            set({ error: error.message, loading: false });
        });

        return unsubscribe;
    },

    signUp: async (email, pass) => {
        set({ loading: true, error: null });
        try {
            await createUserWithEmailAndPassword(auth, email, pass);
            // User is set via onAuthStateChanged
        } catch (err: any) {
            set({ error: err.message, loading: false });
            throw err;
        }
    },

    login: async (email, pass) => {
        set({ loading: true, error: null });
        try {
            await signInWithEmailAndPassword(auth, email, pass);
            // User is set via onAuthStateChanged
        } catch (err: any) {
            set({ error: err.message, loading: false });
            throw err;
        }
    },

    loginWithGoogle: async () => {
        set({ loading: true, error: null });
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
            // User is set via onAuthStateChanged
        } catch (err: any) {
            set({ error: err.message, loading: false });
            throw err;
        }
    },

    logout: async () => {
        set({ loading: true, error: null });
        try {
            await signOut(auth);
            set({ user: null, loading: false });
        } catch (err: any) {
            set({ error: err.message, loading: false });
            throw err;
        }
    },

    resetError: () => set({ error: null }),

    skipLogin: () => set({ isGuest: true, loading: false })
}));
