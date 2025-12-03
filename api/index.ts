import { Server, type Socket } from "socket.io";
import "dotenv/config";
import { request } from "./request";

const origins = (process.env.ORIGINS ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);

/**
 * Initializes the Socket.io server with CORS configuration.
 * Allows connections only from configured origins.
 */
const io = new Server({
  cors: {
    origin: origins,
    methods: ["GET", "POST", "PUT"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
});

const port = Number(process.env.PORT);

/**
 * @typedef {Object} ChatMessagePayload
 * @property {string} userId - ID of the user sending the message.
 * @property {string} message - Message content.
 * @property {string} [timestamp] - Optional timestamp of the message.
 */
type ChatMessagePayload = {
  userId: string;
  message: string;
  timestamp?: string;
};

/**
 * @typedef {Object} UserWithSocketId
 * @property {string} userId - Unique user ID.
 * @property {string} socketId - Socket ID associated with the user.
 * @property {string|null} [name] - User's name.
 * @property {string|null} [email] - User's email.
 * @property {number|null} [age] - User's age.
 * @property {string|null} [photoURL] - URL to the user's profile picture.
 * @property {string|null} [createdAt] - Timestamp of user creation.
 * @property {string|null} [updatedAt] - Timestamp of last update.
 */
type UserWithSocketId = {
  userId: string;
  socketId: string;
  name?: string | null;
  email?: string | null;
  age?: number | null;
  photoURL?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

/**
 * @typedef {Object} BackendError
 * @property {string} error - Error message returned by backend.
 */
type BackendError = { error: string };

/**
 * Handles incoming socket connections.
 */
io.on("connection", (socket: Socket) => {
  console.log("New connection:", socket.id);

  /**
   * Registers a new user joining a meeting.
   *
   * @event newUser
   * @param {string} token - Authentication token.
   * @param {string} userId - ID of the joining user.
   * @param {string} meetId - ID of the meeting room.
   */
  socket.on(
    "newUser",
    async (token: string, userId: string, meetId: string) => {
      console.log(
        `Attempting to register new user: ${userId} in meeting: ${meetId}`,
      );

      try {
        if (!meetId || !userId || !token) {
          socket.emit("chatServerError", {
            origin: "newUser",
            message: "Missing parameters",
          });
          return;
        }

        // Store user and meeting information in socket session
        socket.data = { token, userId, meetId };

        /**
         * Sends a request to backend to add or update user in the meeting.
         */
        const meetUsers = await request<UserWithSocketId[] | BackendError>({
          method: "PUT",
          endpoint: `/api/meetings/updateOrAddMeetingUser/${meetId}`,
          data: { userId, socketId: socket.id },
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        if (!meetUsers || "error" in meetUsers) {
          console.error("Error getting meeting users:", meetUsers);
          socket.emit("chatServerError", {
            origin: "newUser",
            message:
              meetUsers && "error" in meetUsers
                ? meetUsers.error
                : "Unexpected error",
          });
          return;
        }

        socket.join(meetId);
        console.log(`Socket ${socket.id} joined room: ${meetId}`);

        const joiningUser = meetUsers.find((u) => u.userId === userId) || null;
        const leavingUser = null;

        console.log(`User ${userId} joined. Total users: ${meetUsers.length}`);

        /**
         * Emitted when the user list in the meeting changes.
         *
         * @event usersOnline
         * @param {UserWithSocketId[]} meetUsers - Updated list of meeting users.
         * @param {UserWithSocketId|null} joiningUser - User who just joined.
         * @param {UserWithSocketId|null} leavingUser - User who left (null here).
         */
        io.to(meetId).emit("usersOnline", meetUsers, joiningUser, leavingUser);
      } catch (error) {
        console.error("Error in newUser:", error);
        socket.emit("chatServerError", {
          origin: "backend",
          message: error instanceof Error ? error.message : "Unexpected error",
        });
      }
    },
  );

  /**
   * Sends a chat message to all users in a meeting.
   *
   * @event sendMessage
   * @param {ChatMessagePayload} payload - Message payload.
   */
  socket.on("sendMessage", (payload: ChatMessagePayload) => {
    const meetId = socket.data?.meetId;

    console.log(`Attempting to send message in meeting: ${meetId}`);
    console.log(`From user: ${payload.userId}`);
    console.log(`Message content: "${payload.message}"`);

    try {
      if (!meetId) {
        console.error("Socket not associated with any meeting");
        socket.emit("chatServerError", {
          origin: "sendMessage",
          message: "Not in a meeting room",
        });
        return;
      }

      const trimmed = payload?.message?.trim();
      if (!trimmed) {
        console.log("Empty message, ignoring");
        return;
      }

      const outgoing = {
        userId: payload.userId,
        message: trimmed,
        timestamp: payload.timestamp ?? new Date().toISOString(),
      };

      console.log(`Broadcasting message to room ${meetId}`);

      io.to(meetId).emit("newMessage", outgoing);

      console.log(`Message successfully broadcasted to ${meetId}`);
    } catch (error) {
      console.error("❌ Error in sendMessage:", error);
      socket.emit("chatServerError", {
        origin: "sendMessage",
        message: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  });

  /**
   * ✅ Finalizes the meeting for all participants.
   *
   * @event endMeeting
   * @param {string} meetingId - ID of the meeting to end.
   */
  socket.on("endMeeting", async (meetingId: string) => {
    console.log(`🔚 Host ending meeting: ${meetingId}`);

    try {
      if (!meetingId) {
        console.error("❌ No meeting ID provided");
        return;
      }

      // ✅ Notificar a TODOS los usuarios en la sala que la reunión terminó
      io.to(meetingId).emit("meetingEnded", {
        message: "La reunión ha sido finalizada por el anfitrión",
      });

      console.log(
        `✅ Meeting ${meetingId} ended notification sent to all users`,
      );
    } catch (error) {
      console.error("❌ Error ending meeting:", error);
      socket.emit("chatServerError", {
        origin: "endMeeting",
        message: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  });

  /**
   * Cleans up user data when their socket disconnects.
   *
   * @event disconnect
   */
  socket.on("disconnect", async () => {
    const { token, userId, meetId } = socket.data || {};

    console.log(`Socket ${socket.id} disconnected`);

    try {
      if (!userId || !meetId) {
        console.log("No user data found for disconnected socket");
        return;
      }

      console.log(`Cleaning up user ${userId} from meeting ${meetId}`);

      socket.leave(meetId);

      /**
       * Sends a request to backend to remove user from the meeting.
       */
      const meetUsers = await request<UserWithSocketId[] | BackendError>({
        method: "PUT",
        endpoint: `/api/meetings/removeUser/${meetId}`,
        data: { userId, socketId: socket.id },
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!meetUsers || "error" in meetUsers) {
        console.error("Error removing user:", meetUsers);
        return;
      }

      const joiningUser = null;
      const leavingUser = { userId, socketId: socket.id };

      console.log(`User ${userId} removed. Remaining: ${meetUsers.length}`);

      io.to(meetId).emit("usersOnline", meetUsers, joiningUser, leavingUser);
    } catch (error) {
      console.error("Error in disconnect handler:", error);
    }
  });
});

io.listen(port);
console.log(`Chat server running on port ${port}`);
console.log(`Allowed origins:`, origins);
