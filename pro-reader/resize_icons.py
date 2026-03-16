from PIL import Image
import os

os.chdir('icons')

# Load the 256px icon
img = Image.open('icon256.png')

# Create resized versions
sizes = [16, 48, 128]
for size in sizes:
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(f'icon{size}.png')
    print(f'Created icon{size}.png')
