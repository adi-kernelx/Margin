import * as functions from "firebase-functions";
import { google } from "googleapis";

export const testDriveAccess = functions.https.onRequest(
  async (req, res) => {
    try {
      const base64 = process.env.DRIVE_SERVICE_ACCOUNT_BASE64;
      if (!base64) {
        throw new Error("Missing DRIVE_SERVICE_ACCOUNT_BASE64");
      }

      const credentials = JSON.parse(
        Buffer.from(base64, "base64").toString("utf8")
      );

      const auth = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ["https://www.googleapis.com/auth/drive"],
      });

      const drive = google.drive({ version: "v3", auth });

      const folderResponse = await drive.files.create({
        requestBody: {
          name: "drive_test_from_firebase",
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id, name",
      });

      res.status(200).json({
        ok: true,
        folderId: folderResponse.data.id,
        folderName: folderResponse.data.name,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
