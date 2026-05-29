import { setupServer } from "msw/node";
import { phoneHandlers } from "./handlers";

export const server = setupServer(...phoneHandlers());
