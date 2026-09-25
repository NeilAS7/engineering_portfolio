# 🚀 Neil St. Amor - Systems & Software Portfolio Showcase

A curated public sandbox highlighting production-grade artificial intelligence pipelines, high-performance Go backend systems, native mobile architecture, type-safe web dashboards, and low-level memory engineering.

## 📁 Repository Architecture & Technical Deep-Dive

### 1. `/ai-inference` (`llama_interface.py`)
* **Local LLM Infrastructure:** Configures standalone text-generation inference pipelines utilizing the Hugging Face `transformers` library mapped to Local Llama 3.2 parameters.
* **Hardware Computation Allocation:** Implements adaptive compute routing to bind heavy model tensors directly onto native hardware acceleration layers (`device="cuda"` / Nvidia GPU / PyTorch).
* **Object-Oriented Design:** Packages pipeline initializations and tokenization arrays inside memory-isolated class objects (`LLaMAInterface`).

### 2. `/backend-go` (`authHandlers.go`)
* **High-Velocity Microservice Routing:** Drives secure endpoint networks using the high-velocity **Fiber web framework** (`fiber.Ctx`).
* **Direct Memory Directives:** Hydrates decoupled response structures through manual memory address pointers (`&input`, `&userData`) to directly interact with client data layers securely.

### 3. `/mobile-react-native` (`NewEntryScreen.tsx`)
* **Asynchronous Mobile Data Transactions:** Dispatches secure entry updates to remote database tables (`supabaseAnon.from('entries')`).
* **Event Instrumentation:** Hooks telemetry captures into metric frameworks (`posthog.capture`) and handles structural trace validation (`handleAudit`).

### 4. `/frontend-nextjs` (`Session.tsx` & Style Modules)
* **Low-Level Browser API Tracking:** Implements persistent media references (`useRef`) to capture native audio matrices (`MediaStream`) and bundle raw binary fragments (`Blob[]`) safely.
* **Strict Structural Typing:** Configures TypeScript data definitions mapping server responses into immutable structures (`Session`, `SOAP`).

### 5. `/backend-express` (`patients.ts`)
* **Data Fidelity Safeguards:** Leverages **Zod schemas** (`arraySchema.safeParse`) to validate parameter boundaries prior to running database mutations.

*Note: Fully active production servers, private deployment credentials, cloud tokens, and sensitive business logic have been entirely stripped from this public portfolio showcase repository to protect intellectual property. All of the files were taken from personal projects to showcase abilities*
