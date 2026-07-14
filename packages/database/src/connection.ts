import mongoose from "mongoose";

let connected = false;

export async function connectToDatabase(uri: string): Promise<void> {
  if (connected) {
    return;
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });

  connected = true;
  console.log("[database] Connected to MongoDB");

  mongoose.connection.on("disconnected", () => {
    connected = false;
    console.warn("[database] MongoDB disconnected");
  });

  mongoose.connection.on("reconnected", () => {
    connected = true;
    console.log("[database] MongoDB reconnected");
  });
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
  connected = false;
}

export function isConnected(): boolean {
  return connected;
}
