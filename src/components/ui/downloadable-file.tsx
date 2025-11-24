import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DownloadableFileProps {
  fileName: string;
  filePath: string;
  description: string;
}

const DownloadableFile = ({ fileName, filePath, description }: DownloadableFileProps) => {
  const handleDownload = () => {
    // Create a temporary anchor element to trigger the download
    const link = document.createElement('a');
    link.href = filePath;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex items-center justify-between p-3 border rounded-md">
      <div className="flex-1">
        <p className="font-medium">{fileName}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={handleDownload}>
        <Download className="h-4 w-4 mr-2" />
        Download
      </Button>
    </div>
  );
};

export default DownloadableFile;