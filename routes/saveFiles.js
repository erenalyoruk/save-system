const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const authMiddleware = require('../middleware/auth');
const logger = require('../config/logger'); // Import shared logger

// Initialize Supabase client
// This will be used by route handlers to interact with Supabase
// Ensure your .env file has SUPABASE_URL and SUPABASE_ANON_KEY
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- Simple In-Memory Cache ---
const cache = {}; // Our simple cache object
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL for cache entries

function getCache(key) {
  const entry = cache[key];
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    logger.info({ cacheKey: key }, 'Cache HIT');
    return entry.data;
  }
  if (entry) {
    logger.warn({ cacheKey: key }, 'Cache STALE. Deleting.');
    delete cache[key]; // Remove stale entry
  }
  logger.info({ cacheKey: key }, 'Cache MISS');
  return null;
}

function setCache(key, data) {
  logger.info({ cacheKey: key }, 'Cache SET');
  cache[key] = {
    data: data,
    timestamp: Date.now(),
  };
}

function invalidateCache(key) {
  logger.info({ cacheKey: key }, 'Cache INVALIDATE');
  if (cache[key]) {
    delete cache[key];
  }
}
// --- End Simple In-Memory Cache ---

// Configure Multer for file uploads
// We'll store files in memory first before uploading to Supabase Storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // Example: 50MB limit per file, adjust as needed for free tier
});

// Protect all routes in this file with the auth middleware
router.use(authMiddleware);

// POST /api/saves/upload - Upload a new save file
router.post('/upload', upload.single('savefile'), async (req, res) => {
  // Implementation to follow:
  // 1. Get user from req.user
  // 2. Check if req.file exists
  // 3. Construct storage path (e.g., `${user.id}/${req.file.originalname}`)
  // 4. Upload file to Supabase Storage
  // 5. Insert/update metadata in `save_metadata` table
  // 6. Handle errors and send response
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  const user = req.user;
  const fileName = req.file.originalname;
  const filePath = `${user.id}/${Date.now()}_${fileName}`; // Add timestamp to avoid overwrites of same name by mistake, ensure uniqueness
  const fileSize = req.file.size;
  const gameVersion = req.body.version || '1.0'; // Example: get version from request body
  const customMetadata = req.body.custom_metadata ? JSON.parse(req.body.custom_metadata) : {};

  logger.info({ userId: user.id, filePath: filePath }, `Attempting to upload file: ${fileName}`);

  try {
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('save-files')
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true, // true to overwrite if file exists, false to fail
      });

    if (uploadError) {
      logger.error({ err: uploadError, userId: user.id, filePath: filePath }, 'Supabase Storage upload error');
      return res.status(500).json({
        message: 'Failed to upload file to storage.',
        details: uploadError.message,
      });
    }
    logger.info({ userId: user.id, filePath: filePath }, 'File uploaded to Supabase Storage');

    // Insert metadata into the database
    // We use upsert to handle cases where a save file with the same name for the user might be re-uploaded
    // If you prefer strict new uploads or distinct versions, adjust the logic and unique constraints
    const { data: metaData, error: metaError } = await supabase
      .from('save_metadata')
      .upsert(
        {
          user_id: user.id,
          file_name: fileName, // User-facing file name
          storage_path: filePath, // Actual path in storage
          size_bytes: fileSize,
          version: gameVersion,
          custom_metadata: customMetadata,
          // created_at and updated_at are handled by database defaults/triggers
        },
        {
          onConflict: 'user_id,file_name', // Assuming you want to update if user uploads same file_name again
          // Or use storage_path for true uniqueness if file_name can be reused with different internal paths
        },
      )
      .select(); // Important to get the inserted/updated row back

    if (metaError) {
      logger.error({ err: metaError, userId: user.id }, 'Supabase metadata insertion error');
      // Attempt to clean up storage if metadata fails
      await supabase.storage.from('save-files').remove([filePath]);
      return res.status(500).json({
        message: 'Failed to save file metadata.',
        details: metaError.message,
      });
    }

    // Invalidate cache for this user's save list
    const cacheKey = `user:${user.id}:saves`;
    invalidateCache(cacheKey);

    res.status(201).json({ message: 'File uploaded successfully.', data: metaData[0] });
  } catch (error) {
    logger.error({ err: error, userId: user.id }, 'Upload endpoint error');
    res.status(500).json({
      message: 'An unexpected error occurred during file upload.',
      details: error.message,
    });
  }
});

// GET /api/saves - List all save files for the authenticated user
router.get('/', async (req, res) => {
  const user = req.user;
  const cacheKey = `user:${user.id}:saves`;
  logger.info({ userId: user.id, cacheKey: cacheKey }, 'Fetching save files for user');

  // Try to get data from cache first
  const cachedSaves = getCache(cacheKey);
  if (cachedSaves) {
    return res.status(200).json(cachedSaves);
  }

  // If not in cache or stale, fetch from Supabase
  logger.info({ cacheKey: cacheKey }, 'No valid cache, fetching from Supabase.');
  try {
    const { data, error } = await supabase
      .from('save_metadata')
      .select('id, file_name, size_bytes, version, custom_metadata, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });

    if (error) {
      logger.error({ err: error, userId: user.id }, 'Supabase metadata fetch error');
      return res.status(500).json({
        message: 'Failed to retrieve save files list.',
        details: error.message,
      });
    }

    // Store the fetched data in cache
    setCache(cacheKey, data);

    res.status(200).json(data);
  } catch (error) {
    logger.error({ err: error, userId: user.id }, 'List files endpoint error');
    console.error('List files endpoint error:', error);
    res.status(500).json({
      message: 'An unexpected error occurred while listing files.',
      details: error.message,
    });
  }
});

// GET /api/saves/download/:fileName - Download a specific save file
router.get('/download/:fileName', async (req, res) => {
  const user = req.user;
  const { fileName } = req.params;
  console.log(`User ${user.id} attempting to download file: ${fileName}`);

  try {
    // First, verify the user owns this file by checking metadata
    const { data: meta, error: metaError } = await supabase
      .from('save_metadata')
      .select('storage_path, file_name')
      .eq('user_id', user.id)
      .eq('file_name', fileName)
      .single(); // We expect only one file with this name for this user

    if (metaError || !meta) {
      console.error('Download metadata check error or file not found:', metaError);
      return res.status(404).json({ message: 'Save file not found or access denied.' });
    }

    // Download the file from Supabase Storage
    const { data: downloadData, error: downloadError } = await supabase.storage
      .from('save-files')
      .download(meta.storage_path);

    if (downloadError) {
      console.error('Supabase Storage download error:', downloadError);
      return res.status(500).json({
        message: 'Failed to download file from storage.',
        details: downloadError.message,
      });
    }

    // const fileContents = await downloadData.arrayBuffer(); // For binary data to send
    // res.setHeader('Content-Disposition', `attachment; filename="${meta.file_name}"`);
    // res.setHeader('Content-Type', 'application/octet-stream'); // Or appropriate MIME type
    // res.send(Buffer.from(fileContents));

    // Piping the stream is more memory efficient for large files
    res.setHeader('Content-Disposition', `attachment; filename="${meta.file_name}"`);
    // Determine Content-Type dynamically or set a default (e.g., application/octet-stream)
    // For game saves, application/octet-stream is usually appropriate.
    // If you stored MIME type with metadata, you could use that.
    res.setHeader('Content-Type', 'application/octet-stream');
    downloadData
      .arrayBuffer()
      .then((buffer) => {
        res.send(Buffer.from(buffer));
      })
      .catch((err) => {
        console.error('Error converting blob to buffer:', err);
        res.status(500).json({ message: 'Failed to process file for download.' });
      });
  } catch (error) {
    console.error('Download endpoint error:', error);
    res.status(500).json({
      message: 'An unexpected error occurred during file download.',
      details: error.message,
    });
  }
});

// DELETE /api/saves/:fileName - Delete a specific save file
router.delete('/:fileName', async (req, res) => {
  const user = req.user;
  const { fileName } = req.params;
  console.log(`User ${user.id} attempting to delete file: ${fileName}`);

  try {
    // 1. Find the metadata to get the storage_path
    const { data: meta, error: metaError } = await supabase
      .from('save_metadata')
      .select('id, storage_path')
      .eq('user_id', user.id)
      .eq('file_name', fileName)
      .single();

    if (metaError || !meta) {
      console.error('Delete metadata check error or file not found:', metaError);
      return res.status(404).json({
        message: 'Save file not found or access denied for deletion.',
      });
    }

    // 2. Delete the file from Supabase Storage
    const { error: storageError } = await supabase.storage.from('save-files').remove([meta.storage_path]);

    if (storageError) {
      // Log error but proceed to delete metadata if critical, or handle more gracefully
      console.error('Supabase Storage delete error (non-critical, proceeding with metadata deletion):', storageError);
      // Potentially return an error here if storage deletion is critical before metadata deletion
      // return res.status(500).json({ message: 'Failed to delete file from storage.', details: storageError.message });
    }

    // 3. Delete the metadata entry from the database
    const { error: dbError } = await supabase.from('save_metadata').delete().eq('id', meta.id);

    if (dbError) {
      console.error('Supabase metadata delete error:', dbError);
      return res.status(500).json({
        message: 'Failed to delete file metadata.',
        details: dbError.message,
      });
    }

    // Invalidate cache for this user's save list
    const cacheKey = `user:${user.id}:saves`;
    invalidateCache(cacheKey);

    res.status(200).json({ message: `Save file '${fileName}' deleted successfully.` });
  } catch (error) {
    console.error('Delete endpoint error:', error);
    res.status(500).json({
      message: 'An unexpected error occurred during file deletion.',
      details: error.message,
    });
  }
});

module.exports = router;
