# AI PDF Reader

An offline-first, AI-enhanced PDF reader and research workspace with collaborative editing, annotation capabilities, OCR processing, and semantic search powered by local RAG (Retrieval-Augmented Generation).

## 🎯 Overview

AI PDF Reader is a comprehensive document management and annotation platform designed for researchers, students, and professionals. It combines powerful PDF viewing with AI-powered semantic search, multilingual OCR, real-time collaboration, and cloud storage integration.

## ✨ Key Features


### ✏️ Annotation System
- **Drawing Tool**: Freehand drawing with customizable colors, stroke width
- **Highlighter**: Text highlighting with multiple colors and opacity
- **Text Tool**: Add text annotations with font customization
- **Shapes**: Rectangle, circle, arrow, and line tools with fill/stroke options
- **Eraser**: Point and stroke eraser with configurable radius
- **Image Tool**: Paste and upload images as annotations
- **Math Equations**: LaTeX equation support via KaTeX
- Canvas-based annotation layer with transform support (resize, rotate)

### 🔍 OCR & Search
- **PaddleOCR Integration**: Multilingual OCR supporting Latin and Devanagari scripts
- **Semantic Search**: Vector-based search using Qdrant and sentence transformers
- **Hybrid Search**: Combines vector search with Typesense keyword search
- **Invisible Text Layer**: OCR results rendered as selectable text overlay

### 🤖 AI-Powered RAG System
- **Local LLM**: Runs Meta-Llama-3.1-8B-Instruct via llama.cpp
- **LangGraph Workflow**: Retrieve → Rerank → Generate pipeline
- **Context-Aware Q&A**: Ask questions about document content with source citations
- **Embedding Cache**: SQLite-based caching to avoid re-embedding

### ☁️ Cloud Storage & Sync
- **AWS S3 Integration**: PDF and annotation storage with presigned URLs
- **Firebase/Firestore**: User authentication and metadata storage
- **Hierarchical Folders**: Recursive folder structure mirrored in S3
- **Autosave**: Configurable autosave with conflict detection

### 👥 Collaboration
- **Real-time Sync**: Y.js + WebSocket for live collaboration
- **Presence Awareness**: See collaborators' cursors and selections
- **Role-based Access**: Editor and Viewer roles
- **Share Links**: Generate shareable links with permissions

### 💾 Local-First Architecture
- **IndexedDB Storage**: Full offline support via Dexie
- **File System Access API**: Direct in-place saving to local files
- **Annotation Caching**: OCR and annotation data persisted locally

## 🛠️ Tech Stack

### Frontend
| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | React 19 + TypeScript | UI framework |
| Build Tool | Vite 7 | Fast development & build |
| PDF Engine | PDF.js 5.x | PDF rendering |
| State Management | Zustand | Global state |
| Local Storage | Dexie (IndexedDB) | Offline-first persistence |
| Styling | Tailwind CSS | Rapid UI development |
| Collaboration | Y.js + y-websocket | Real-time sync |

### Backend
| Component | Technology | Purpose |
|-----------|------------|---------|
| Server | Express.js 5 | REST API |
| Auth | Firebase Admin | Authentication |
| Database | Firestore | Metadata & user data |
| Storage | AWS S3 | PDF & annotation files |
| Vector DB | Qdrant | Semantic search |
| Keyword Search | Typesense | Full-text search |

### AI/ML Services
| Component | Technology | Purpose |
|-----------|------------|---------|
| OCR | PaddleOCR | Text extraction |
| LLM | llama.cpp (Llama 3.1) | Local inference |
| Embeddings | Sentence Transformers | Text embeddings |
| RAG Framework | LangGraph | Query orchestration |

## 📁 Project Structure

```
PDF Reader/
├── src/                          # Frontend (React + TypeScript)
│   ├── components/               # UI Components
│   │   ├── PDFViewer.tsx        # Main PDF rendering
│   │   ├── AnnotationCanvas.tsx # Annotation layer (3000+ LOC)
│   │   ├── Toolbar.tsx          # Tool selection
│   │   ├── SearchBar.tsx        # Semantic search UI
│   │   ├── AIChatSidebar.tsx    # RAG chat interface
│   │   └── FileSystem/          # Cloud file browser
│   ├── lib/                      # Core libraries
│   │   ├── saving/              # Save manager, adapters
│   │   ├── tools/               # Annotation tools
│   │   ├── annotations/         # Annotation models
│   │   └── ocr/                 # Client OCR integration
│   └── pages/                    # Route pages
│
├── backend/                      # Node.js Backend
│   ├── src/
│   │   ├── routes/              # API endpoints
│   │   │   ├── files.ts         # File CRUD
│   │   │   ├── share.ts         # Sharing system
│   │   │   ├── annotations/     # Annotation save/load
│   │   │   └── search-hybrid.ts # Search endpoints
│   │   └── lib/                 # Backend utilities
│   └── lambda/                   # AWS Lambda workers
│
├── ocr-service/                  # PaddleOCR Microservice
│   ├── app/
│   │   ├── main.py              # FastAPI server
│   │   └── ocr_service.py       # OCR processing
│   └── Dockerfile
│
├── local-llm/                    # RAG System
│   ├── docker-compose.yml        # LLM + RAG orchestration
│   └── rag-api/
│       ├── main.py              # FastAPI endpoints
│       ├── graph.py             # LangGraph workflow
│       ├── retriever.py         # Vector retrieval
│       └── ingest.py            # Document ingestion
│
├── ingest-pipeline/              # Data Ingestion
│   ├── ingest_api.py            # Ingestion API (Qdrant)
│   └── search.py                # Search utilities
│
├── ingest-sidecars/              # Offline OCR Ingestion
│   ├── ingest_sidecars.py       # Batch ingestion script
│   └── export_ocr_from_browser.js
│
├── docs/                         # Architecture Documentation
│   ├── CLOUD_ARCHITECTURE.md    # Cloud design spec
│   ├── RAG_ARCHITECTURE.md      # RAG system design
│   └── IMPLEMENTATION_PHASES.md # Development roadmap
│
└── aws/                          # AWS Infrastructure
    ├── k8s/                      # Kubernetes configs
    └── buildspec-*.yml           # CodeBuild specs
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Python 3.10+
- Docker & Docker Compose
- Firebase project (for cloud features)
- AWS account (for S3 storage)

### Frontend Setup
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Backend Setup
```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Firebase/AWS credentials

# Start development server
npm run dev
```

### OCR Service Setup
```bash
cd ocr-service

# Build and run with Docker
docker-compose up --build

# Or run locally
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### RAG System Setup
```bash
cd local-llm

# Download the LLM model
pip install huggingface_hub
python scripts/download_model.py

# Start all services
docker-compose up --build
```

## 📡 API Endpoints

### Files API
- `POST /api/files/upload` - Upload PDF
- `GET /api/folders/:folderId/children` - List files/folders
- `DELETE /api/files/:fileId` - Delete file

### Annotations API
- `POST /api/files/:fileId/open` - Open file (get PDF URL + annotations)
- `POST /api/files/:fileId/annotations/save-request` - Request save URL
- `POST /api/files/:fileId/annotations/confirm` - Confirm save

### Search API
- `POST /api/search` - Hybrid semantic + keyword search
- `POST /api/ingest/ocr` - Ingest OCR data

### RAG API (port 9101)
- `POST /query` - Ask question about documents
- `POST /ingest` - Ingest document chunks
- `GET /status/:fingerprint` - Check ingestion status

## 🔐 Environment Variables

### Frontend (.env)
```env
VITE_FIREBASE_API_KEY=xxx
VITE_FIREBASE_PROJECT_ID=xxx
VITE_BACKEND_URL=http://localhost:4000
```

### Backend (.env)
```env
PORT=4000
AWS_REGION=ap-south-1
AWS_S3_BUCKET=your-bucket
QDRANT_URL=http://localhost:6333
TYPESENSE_HOST=localhost
TYPESENSE_API_KEY=xxx
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

## 🗺️ Future Plans

### Phase 1: Enhanced AI Features
- [ ] **Multi-document RAG**: Query across multiple PDFs simultaneously
- [ ] **Citation Extraction**: Automatically extract and link references
- [ ] **Table Extraction**: Convert PDF tables to structured data
- [ ] **Document Comparison**: Side-by-side comparison with diff highlighting

### Phase 2: Platform Expansion
- [ ] **Mobile Apps**: React Native iOS/Android apps
- [ ] **Browser Extension**: Save webpages as annotated PDFs
- [ ] **API Integrations**: Notion, Zotero, Mendeley connectors
- [ ] **Public API**: Developer access for third-party integrations

### Phase 3: Advanced Search & Analytics
- [ ] **Image Search**: Find pages by image content
- [ ] **Formula Search**: Search for mathematical equations
- [ ] **Usage Analytics**: Reading time, annotation statistics
- [ ] **Knowledge Graph**: Visual map of document relationships

### Phase 4: Enterprise Features
- [ ] **SSO Integration**: SAML/OIDC enterprise auth
- [ ] **Audit Logging**: Compliance-ready activity logs
- [ ] **Data Residency**: Region-specific data storage
- [ ] **White-labeling**: Custom branding for enterprise

## 📊 Architecture Highlights

### Save Flow (Cloud)
1. Client computes SHA-256 hash of annotations
2. Server compares hash with last saved version
3. If different, server returns presigned PUT URL
4. Client uploads directly to S3
5. Server confirms upload and updates Firestore

### OCR Pipeline
1. Client renders PDF page to canvas
2. Canvas sent to PaddleOCR service
3. Results returned with bounding boxes
4. Invisible text layer rendered for selection
5. OCR data cached in IndexedDB

### RAG Query Flow
1. User question → Vector embedding
2. Qdrant retrieval (top-K chunks)
3. Cross-encoder reranking
4. LLM prompt assembly with context
5. Response validation & confidence scoring

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is developed as part of an IIT Patna research project.

---

**Status**: Active Development | Core features complete, AI integration in progress
