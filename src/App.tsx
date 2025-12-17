import { useAppStore } from './store/appStore';
import { Header } from './components/Layout/Header';
import { FileUpload } from './components/Layout/FileUpload';
import { SplitPane } from './components/Layout/SplitPane';
import { ReferenceList } from './components/ReferenceList/ReferenceList';
import { PDFViewer } from './components/PDFViewer/PDFViewer';
import { SettingsPanel } from './components/Settings/SettingsPanel';

function App() {
  const { pdfFile } = useAppStore();
  
  return (
    <div className="h-screen flex flex-col bg-primary text-white">
      <Header />
      
      {pdfFile ? (
        <SplitPane
          left={<ReferenceList />}
          right={<PDFViewer />}
          defaultLeftWidth={420}
          minLeftWidth={320}
          maxLeftWidth={600}
        />
      ) : (
        <FileUpload />
      )}
      
      <SettingsPanel />
    </div>
  );
}

export default App;
